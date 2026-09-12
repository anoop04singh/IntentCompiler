import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { testDB } from "./db-helper.js";
import { Catalog } from "../src/catalog.js";
import { Payments } from "../src/payments.js";
import { usdc } from "../examples/usdc.js";
import type { Config } from "../src/config.js";
export const config = {
  PUBLIC_URL: "http://localhost:3000",
  PORT: 3000,
  ALLOWED_ORIGINS: "http://localhost:3000",
  COMMISSION_AMOUNT: "100000000",
  QUERY_AMOUNT: "100000",
  PAYMENT_ASSET: "0.0.0",
  HEDERA_NETWORK: "hedera:testnet",
  HEDERA_PAY_TO: "0.0.123",
  BLOCKY_FACILITATOR_URL: "https://api.testnet.blocky402.com",
  COMMISSIONING_ENABLED: true,
} as Config;
let fixture: Awaited<ReturnType<typeof testDB>>;
let catalog: Catalog;
beforeEach(async () => {
  fixture = await testDB();
  catalog = new Catalog(fixture.db, config, new Payments(fixture.db, config));
});
afterEach(async () => {
  await fixture.close();
});
it("persists quotes and reuses normalized coverage", async () => {
  const p = (await catalog.create("Track USDC Transfer events", usdc)) as any;
  expect(p.commissionFee).toBe("100000000");
  expect(p.availableSlots).toBe(0);
  const second = (await catalog.create(
    "Index token transfers for USDC",
    usdc,
  )) as any;
  expect(second.pipelineId).toBe(p.pipelineId);
  await fixture.db`update graphrail.pipelines set state='ready' where id=${p.pipelineId}`;
  const matched = (await catalog.create(
    "Same source in different words",
    usdc,
  )) as any;
  expect(matched.matched).toBe(p.pipelineId);
  expect(
    (await fixture.pg.query("select * from graphrail.pipelines")).rows,
  ).toHaveLength(1);
});
it("does not expose endpoints, keys or unready pipelines", async () => {
  const p = (await catalog.create("Track USDC transfers", usdc)) as any;
  await fixture.db`insert into graphrail.slots(id,deployment_id,network,db_schema,postgres_config,secret_ready,pipeline_id)values(${randomUUID()},'secret','sepolia','gr_00000000000000000000000000000001','{}',true,${p.pipelineId})`;
  expect(await catalog.list()).toEqual([]);
  await fixture.db`update graphrail.pipelines set state='ready' where id=${p.pipelineId}`;
  const list = await catalog.list();
  expect(list).toHaveLength(1);
  expect(JSON.stringify(list)).not.toContain("secret");
  const perms = await fixture.pg.query(
    "select has_schema_privilege('anon','graphrail','USAGE') as access",
  );
  expect(perms.rows[0]).toEqual({ access: false });
});
it("gives prompt-only agents a free next action without fabricating a plan", async () => {
  const r = (await catalog.create("Track volume and swaps")) as any;
  expect(r.status).toBe("needs_definition");
  expect(r.candidates).toEqual([]);
});
it("rejects expired plans before asking for money", async () => {
  const p = (await catalog.create("Track USDC transfers", usdc)) as any;
  await fixture.db`update graphrail.plans set expires_at=now()-interval '1 hour' where id=${p.planId}`;
  await expect(catalog.commission(p.planId, randomUUID())).rejects.toThrow(
    "expired",
  );
});
