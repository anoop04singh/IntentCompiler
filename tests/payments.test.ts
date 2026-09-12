import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  TransferTransaction,
  TransactionId,
  Hbar,
  AccountId,
} from "@hiero-ledger/sdk";
import { testDB } from "./db-helper.js";
import { Payments } from "../src/payments.js";
import { Catalog } from "../src/catalog.js";
import type { Config } from "../src/config.js";
import { usdc } from "../examples/usdc.js";

const c = {
  PUBLIC_URL: "http://localhost:3000",
  COMMISSION_AMOUNT: "100000000",
  QUERY_AMOUNT: "100000",
  PAYMENT_ASSET: "0.0.0",
  HEDERA_NETWORK: "hedera:testnet",
  HEDERA_PAY_TO: "0.0.123",
  BLOCKY_FACILITATOR_URL: "https://api.testnet.blocky402.com",
  COMMISSIONING_ENABLED: true,
} as Config;
const req = {
  scheme: "exact",
  network: "hedera:testnet",
  amount: "100000000",
  asset: "0.0.0",
  payTo: "0.0.123",
  maxTimeoutSeconds: 300,
  extra: { feePayer: "0.0.456" },
};
let fixture: Awaited<ReturnType<typeof testDB>>,
  payments: Payments,
  plan: any,
  verify: any,
  settle: any;
beforeEach(async () => {
  fixture = await testDB();
  payments = new Payments(fixture.db, c);
  vi.spyOn(payments, "requirements").mockResolvedValue([req as any]);
  vi.spyOn(payments.server, "findMatchingRequirements").mockReturnValue(
    req as any,
  );
  vi.spyOn(payments.server, "createPaymentRequiredResponse").mockResolvedValue({
    x402Version: 2,
    accepts: [req],
  } as any);
  verify = vi
    .spyOn(payments.server, "verifyPayment")
    .mockResolvedValue({ isValid: true, payer: "0.0.789" });
  settle = vi.spyOn(payments.server, "settlePayment").mockResolvedValue({
    success: true,
    network: "hedera:testnet",
    transaction: "receipt-tx",
    payer: "0.0.789",
  });
  plan = await new Catalog(fixture.db, c, payments).create(
    "Track USDC Transfer events",
    usdc,
  );
  await fixture.db`insert into graphrail.slots(id,deployment_id,network,db_schema,postgres_config,secret_ready)values(${randomUUID()},'usdc','mainnet','gr_00000000000000000000000000000001','{}',true)`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.close();
});
function payload() {
  const tx = new TransferTransaction()
    .setTransactionId(TransactionId.generate(AccountId.fromString("0.0.789")))
    .setNodeAccountIds([AccountId.fromString("0.0.3")])
    .addHbarTransfer("0.0.789", new Hbar(-1))
    .addHbarTransfer("0.0.123", new Hbar(1))
    .freeze();
  return {
    x402Version: 2,
    accepted: req,
    payload: { transaction: Buffer.from(tx.toBytes()).toString("base64") },
  };
}
function args(p = payload()) {
  return {
    kind: "commission" as const,
    pipelineId: plan.pipelineId,
    amount: req.amount,
    request: { planId: plan.planId, requestId: "logical-request" },
    meta: { "x402/payment": p },
  };
}
it("returns an x402 MCP challenge without executing or settling", async () => {
  const execute = vi.fn();
  const a = args();
  a.meta = {};
  const r = await payments.gate(a, execute);
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toHaveProperty("accepts");
  expect(execute).not.toHaveBeenCalled();
  expect(settle).not.toHaveBeenCalled();
});
it("queues exactly once after settlement, including duplicate retries", async () => {
  const a = args();
  const execute = vi.fn(async () => ({ job: "queued" }));
  await payments.gate(a, execute);
  await payments.gate(a, execute);
  expect(settle).toHaveBeenCalledTimes(1);
  expect(
    (await fixture.pg.query("select * from graphrail.jobs")).rows,
  ).toHaveLength(1);
  const rows = (
    await fixture.pg.query("select state,created_by from graphrail.pipelines")
  ).rows;
  expect(rows[0]).toEqual({ state: "queued", created_by: "0.0.789" });
  expect(
    (await fixture.pg.query("select * from graphrail.audit")).rows,
  ).toHaveLength(1);
});
it("binds payment identity to one request", async () => {
  const a = args();
  await payments.gate(a, async () => ({ ok: true }));
  await expect(
    payments.gate({ ...a, request: { different: true } }, async () => ({
      ok: true,
    })),
  ).rejects.toThrow("replay");
  expect(settle).toHaveBeenCalledTimes(1);
});
it("does not settle invalid payments or commission without capacity", async () => {
  verify.mockResolvedValueOnce({ isValid: false });
  await expect(payments.gate(args(), async () => ({}))).rejects.toThrow(
    "verification",
  );
  await fixture.pg.exec("delete from graphrail.slots");
  await expect(payments.gate(args(), async () => ({}))).rejects.toThrow("slot");
  expect(settle).not.toHaveBeenCalled();
});
it("never queues an ambiguous settlement or blindly settles it again", async () => {
  settle.mockRejectedValue(new Error("timeout after submission"));
  const a = args();
  const r = await payments.gate(a, async () => ({}));
  expect(r.structuredContent).toHaveProperty(
    "status",
    "reconciliation_required",
  );
  await payments.gate(a, async () => ({}));
  expect(settle).toHaveBeenCalledTimes(1);
  expect(
    (await fixture.pg.query("select * from graphrail.jobs")).rows,
  ).toHaveLength(0);
});
it("failed Graph reads are not charged and delivered query payments cannot be reused", async () => {
  const a = { ...args(), kind: "query" as const };
  await expect(
    payments.gate(a, async () => {
      throw new Error("Graph unavailable");
    }),
  ).rejects.toThrow("unavailable");
  expect(settle).not.toHaveBeenCalled();
  await payments.gate(a, async () => ({ data: { transfers: [] } }));
  await expect(payments.gate(a, async () => ({ data: {} }))).rejects.toThrow(
    "already delivered",
  );
  expect(settle).toHaveBeenCalledTimes(1);
});
