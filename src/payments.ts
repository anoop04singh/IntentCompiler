import { randomUUID } from "node:crypto";
import { Transaction } from "@hiero-ledger/sdk";
import {
  x402ResourceServer,
  extractPaymentFromMeta,
  attachPaymentResponseToMeta,
} from "@x402/mcp";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import type { Config } from "./config.js";
import type { DB, Row } from "./db.js";
import { digest } from "./spec.js";

export const result = (data: Record<string, unknown>, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data,
  isError,
});
export function transactionKey(payload: PaymentPayload): string {
  const bytes = payload.payload.transaction;
  if (
    typeof bytes !== "string" ||
    bytes.length > 32_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(bytes)
  )
    throw new Error("Invalid Hedera transaction");
  const tx = Transaction.fromBytes(Buffer.from(bytes, "base64"));
  const key = tx.transactionId?.toString();
  if (!key || !/^0\.0\.\d+@\d+\.\d+$/.test(key))
    throw new Error("Missing Hedera transaction ID");
  // Transaction identity survives re-encoding and changes to signature-map ordering.
  return key;
}
export class Payments {
  readonly server: x402ResourceServer;
  constructor(
    readonly db: DB,
    readonly c: Config,
  ) {
    const facilitator = {
      getSupported: () => this.call("/supported"),
      verify: (
        paymentPayload: PaymentPayload,
        paymentRequirements: PaymentRequirements,
      ) =>
        this.call("/verify", {
          x402Version: 2,
          paymentPayload,
          paymentRequirements,
        }),
      settle: (
        paymentPayload: PaymentPayload,
        paymentRequirements: PaymentRequirements,
      ) =>
        this.call("/settle", {
          x402Version: 2,
          paymentPayload,
          paymentRequirements,
        }),
    };
    this.server = new x402ResourceServer(facilitator).register(
      c.HEDERA_NETWORK,
      new ExactHederaScheme(),
    );
  }
  async call(path: string, body?: unknown): Promise<any> {
    const r = await fetch(this.c.BLOCKY_FACILITATOR_URL + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(this.c.BLOCKY_API_KEY
          ? { "X-Api-Key": this.c.BLOCKY_API_KEY }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
    });
    if (!r.ok) throw new Error(`Facilitator HTTP ${r.status}`);
    return r.json();
  }
  async initialize() {
    await this.server.initialize();
  }
  async requirements(amount: string) {
    return this.server.buildPaymentRequirements({
      scheme: "exact",
      network: this.c.HEDERA_NETWORK,
      payTo: this.c.HEDERA_PAY_TO,
      price: { amount, asset: this.c.PAYMENT_ASSET },
      maxTimeoutSeconds: 300,
    });
  }
  async gate(
    args: {
      kind: "commission" | "query";
      pipelineId: string;
      amount: string;
      request: unknown;
      meta?: Record<string, unknown>;
    },
    execute: (payment: Row, db: DB) => Promise<Record<string, unknown>>,
  ) {
    const accepts = await this.requirements(args.amount);
    const payment = extractPaymentFromMeta({
      name: args.kind,
      _meta: args.meta,
    });
    const requestHash = digest({
      kind: args.kind,
      pipeline: args.pipelineId,
      args: args.request,
    });
    if (!payment) {
      const required = await this.server.createPaymentRequiredResponse(
        accepts,
        {
          url: `${this.c.PUBLIC_URL}/mcp#${args.kind}/${requestHash}`,
          description: `GraphRail ${args.kind}`,
          mimeType: "application/json",
        },
      );
      return result(required as unknown as Record<string, unknown>, true);
    }
    const requirements = this.server.findMatchingRequirements(accepts, payment);
    if (!requirements)
      throw new Error(
        "Payment does not match the quoted amount, asset, network or recipient",
      );
    const key = transactionKey(payment);
    // Session advisory lock serializes a single transaction, including external settlement.
    const connection = await this.db.reserve();
    try {
      const [lock] =
        await connection`select pg_try_advisory_lock(hashtextextended(${key}, 0)) as locked`;
      if (!lock?.locked)
        return result(
          { status: "payment_in_progress", retryWithSamePayment: true },
          true,
        );
      try {
        let prepared: Record<string, unknown> | undefined;
        let [row] =
          await connection`select * from graphrail.payments where transaction_key=${key}`;
        if (row && row.request_hash !== requestHash)
          throw new Error(
            "Payment replay rejected: transaction is already bound to another request",
          );
        if (row && ["settling", "reconciliation_required"].includes(row.state))
          return result(
            {
              status: "reconciliation_required",
              paymentId: row.id,
              retryWithSamePayment: true,
            },
            true,
          );
        if (row?.state === "failed")
          throw new Error("This payment failed; create a new payment");
        if (!row || row.state === "verifying") {
          const verified = await this.server.verifyPayment(
            payment,
            requirements,
          );
          if (!verified.isValid || !verified.payer)
            throw new Error("Payment verification failed");
          if (args.kind === "query")
            prepared = await execute({ payer: verified.payer }, connection);
          if (!row) {
            [row] =
              await connection`insert into graphrail.payments (id,transaction_key,request_hash,kind,pipeline_id,state,payer,requirements,payload)
              values (${randomUUID()},${key},${requestHash},${args.kind},${args.pipelineId},'verifying',${verified.payer},${connection.json(JSON.parse(JSON.stringify(requirements)))},${connection.json(JSON.parse(JSON.stringify(payment)))}) returning *`;
          }
          if (args.kind === "commission")
            await this.reserveSlot(args.pipelineId, row!.id, connection);
          const submitted =
            await connection`update graphrail.payments set state='settling',updated_at=now() where id=${row!.id} and state='verifying' returning id`;
          if (!submitted.length)
            throw new Error(
              "Payment expired before submission; no transaction was submitted",
            );
          let settlement: SettleResponse;
          try {
            settlement = await this.server.settlePayment(payment, requirements);
          } catch {
            return result(
              {
                status: "reconciliation_required",
                paymentId: row!.id,
                retryWithSamePayment: true,
              },
              true,
            );
          }
          if (!settlement.success) {
            // A failure response can follow a submitted transaction. Reconcile against the ledger.
            await connection`update graphrail.payments set state='reconciliation_required',updated_at=now() where id=${row!.id}`;
            return result(
              {
                status: "reconciliation_required",
                paymentId: row!.id,
                retryWithSamePayment: true,
              },
              true,
            );
          }
          await this.recordSettlement(row!, settlement, connection);
          [row] =
            await connection`select * from graphrail.payments where id=${row!.id}`;
        }
        if (args.kind === "query" && row!.response_delivered)
          throw new Error(
            "This payment has already delivered a query result; use a new requestId and payment",
          );
        const data = prepared ?? (await execute(row!, connection));
        if (args.kind === "query")
          await connection`update graphrail.payments set response_delivered=true where id=${row!.id}`;
        const response = result({
          ...data,
          paymentId: row!.id,
          hcsReceipt: {
            status: "pending_or_recorded",
            lookupTool: "get_payment_receipt",
          },
        });
        return {
          ...response,
          _meta: attachPaymentResponseToMeta(response, row!.settlement)._meta,
        };
      } finally {
        await connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
      }
    } finally {
      connection.release();
    }
  }
  async reserveSlot(pipelineId: string, paymentId: string, db: DB = this.db) {
    await db.begin(async (tx) => {
      const [p] =
        await tx`select * from graphrail.pipelines where id=${pipelineId} for update`;
      if (!p || p.state !== "awaiting_payment")
        throw new Error(
          "Pipeline already commissioned; retrieve status instead",
        );
      const [existing] =
        await tx`select id from graphrail.slots where pipeline_id=${pipelineId}`;
      if (existing) {
        const [owner] =
          await tx`select id from graphrail.payments where pipeline_id=${pipelineId} and kind='commission' and state in ('verifying','settling','reconciliation_required') order by created_at limit 1`;
        if (owner?.id === paymentId) return;
        throw new Error(
          "A commission payment is already in progress for this pipeline",
        );
      }
      const [slot] =
        await tx`select id from graphrail.slots where network=${p.definition.network} and pipeline_id is null and secret_ready=true for update skip locked limit 1`;
      if (!slot)
        throw new Error(
          "No prepared hosted deployment slot is available; payment has not been settled",
        );
      await tx`update graphrail.slots set pipeline_id=${pipelineId},reserved_until=now()+interval '10 minutes' where id=${slot.id}`;
    });
  }
  async recordSettlement(
    payment: Row,
    settlement: SettleResponse,
    db: DB = this.db,
  ) {
    await db.begin(async (tx) => {
      await tx`update graphrail.payments set state='settled',settlement=${tx.json(JSON.parse(JSON.stringify(settlement)))},updated_at=now() where id=${payment.id}`;
      if (payment.kind === "commission") {
        await tx`update graphrail.pipelines set state='queued',created_by=${payment.payer},updated_at=now() where id=${payment.pipeline_id} and state='awaiting_payment'`;
        await tx`insert into graphrail.jobs (id,pipeline_id) values (${randomUUID()},${payment.pipeline_id}) on conflict (pipeline_id) do nothing`;
        await tx`update graphrail.slots set reserved_until=null where pipeline_id=${payment.pipeline_id}`;
      }
      const payload = {
        type: payment.kind,
        pipelineId: payment.pipeline_id,
        paymentId: payment.id,
        requestHash: payment.request_hash,
        payer: payment.payer,
        transaction: settlement.transaction,
        network: settlement.network,
      };
      await tx`insert into graphrail.audit (id,event_key,payload) values (${randomUUID()},${`payment:${payment.id}`},${tx.json(payload)}) on conflict(event_key) do nothing`;
    });
  }
  async reconcile() {
    // A crash before entering 'settling' cannot have submitted a transaction. Expire only that phase.
    await this.db.begin(async (tx) => {
      const abandoned =
        await tx`update graphrail.payments set state='failed',updated_at=now() where state='verifying' and updated_at<now()-interval '10 minutes' returning pipeline_id,kind`;
      for (const p of abandoned)
        if (p.kind === "commission")
          await tx`update graphrail.slots set pipeline_id=null,reserved_until=null where pipeline_id=${p.pipeline_id} and reserved_until<now() and not exists(select 1 from graphrail.payments where pipeline_id=${p.pipeline_id} and state in ('settling','settled','reconciliation_required'))`;
    });
    const rows = await this
      .db`select * from graphrail.payments where state in ('settling','reconciliation_required') and updated_at<now()-interval '30 seconds' limit 10`;
    for (const p of rows) {
      const mirrorId = p.transaction_key
        .replace("@", "-")
        .replace(/\.(\d+)$/, "-$1");
      const r = await fetch(
        `https://testnet.mirrornode.hedera.com/api/v1/transactions/${mirrorId}`,
        { signal: AbortSignal.timeout(15000), redirect: "error" },
      );
      if (r.status === 404) continue; // Absence is not proof of failure; do not charge again automatically.
      if (!r.ok) continue;
      const data = (await r.json()) as { transactions?: any[] };
      const t = data.transactions?.find(
        (v) =>
          v.result === "SUCCESS" && !v.scheduled && v.name === "CRYPTOTRANSFER",
      );
      const req = p.requirements as PaymentRequirements;
      if (t) {
        const transfers =
          req.asset === "0.0.0"
            ? t.transfers
            : t.token_transfers?.filter((v: any) => v.token_id === req.asset);
        if (
          transfers?.some(
            (v: any) =>
              typeof v.amount === "number" && !Number.isSafeInteger(v.amount),
          )
        )
          continue;
        const paid = transfers
          ?.filter((v: any) => v.account === req.payTo)
          .reduce((n: bigint, v: any) => n + BigInt(v.amount), 0n);
        if (paid === BigInt(req.amount))
          await this.recordSettlement(p, {
            success: true,
            network: req.network,
            transaction: p.transaction_key,
            payer: p.payer,
          });
      } else if (
        data.transactions?.some(
          (v) => v.result && v.result !== "DUPLICATE_TRANSACTION",
        )
      ) {
        await this
          .db`update graphrail.payments set state='failed',updated_at=now() where id=${p.id} and state<>'settled'`;
        if (p.kind === "commission")
          await this
            .db`update graphrail.slots set pipeline_id=null,reserved_until=null where pipeline_id=${p.pipeline_id} and reserved_until is not null`;
      }
    }
  }
}
