import { randomUUID } from "node:crypto";
import type { DB, Row } from "./db.js";
import type { Config } from "./config.js";
import { validateDefinition, fingerprint, entitySchema } from "./spec.js";
import { Payments, result } from "./payments.js";
import { readSql, validateQuery } from "./query.js";

export function publicPipeline(row: Row) {
  return {
    pipelineId: row.id,
    description: row.description,
    chain: row.definition.network,
    contracts: row.definition.contracts,
    events: row.definition.events,
    startBlock: row.definition.startBlock,
    schema: row.entity_schema,
    pricePerQuery: row.price,
    status: row.state,
    createdBy: row.created_by,
    createdAt: row.created_at,
    indexedBlock: row.indexed_block,
  };
}
export class Catalog {
  constructor(
    readonly db: DB,
    readonly c: Config,
    readonly payments: Payments,
  ) {}
  async list(keyword = "") {
    const rows = keyword.trim()
      ? await this
          .db`select * from graphrail.pipelines where state='ready' and to_tsvector('english',description) @@ plainto_tsquery('english',${keyword}) order by created_at desc limit 30`
      : await this
          .db`select * from graphrail.pipelines where state='ready' order by created_at desc limit 30`;
    return rows.map(publicPipeline);
  }
  async create(prompt: string, definition?: unknown) {
    const candidates = await this.list(prompt);
    if (!definition)
      return {
        status: "needs_definition",
        candidates,
        nextAction:
          "Read graphrail://skills/workflow; extract the exact network, contracts, ABI events and block ranges from the intent and verified sources, then call create_pipeline again with definition. Reuse a candidate only after confirming its coverage.",
        definitionRequired: true,
      };
    const d = validateDefinition(definition);
    const hash = fingerprint(d);
    return this.db.begin(async (tx) => {
      let [p] =
        await tx`select * from graphrail.pipelines where fingerprint=${hash}`;
      if (p && p.state !== "awaiting_payment")
        return {
          matched: p.id,
          ...publicPipeline(p),
          nextAction:
            p.state === "ready" ? "query_pipeline" : "get_pipeline_status",
        };
      const schema = entitySchema(d);
      if (!p) {
        [p] =
          await tx`insert into graphrail.pipelines (id,fingerprint,description,definition,entity_schema,price,state) values (${randomUUID()},${hash},${prompt},${tx.json(d)},${schema},${this.c.QUERY_AMOUNT},'awaiting_payment') on conflict(fingerprint) do update set fingerprint=excluded.fingerprint returning *`;
      }
      if (p!.state !== "awaiting_payment")
        return { matched: p!.id, ...publicPipeline(p!) };
      const planId = randomUUID();
      const expires = new Date(Date.now() + 30 * 60 * 1000);
      await tx`insert into graphrail.plans (id,pipeline_id,commission_amount,expires_at) values (${planId},${p!.id},${this.c.COMMISSION_AMOUNT},${expires})`;
      const [capacity] =
        await tx`select count(*)::int as count from graphrail.slots where pipeline_id is null and secret_ready=true and network=${d.network}`;
      return {
        planId,
        pipelineId: p!.id,
        definition: d,
        schema,
        commissionFee: this.c.COMMISSION_AMOUNT,
        pricePerQuery: p!.price,
        asset: this.c.PAYMENT_ASSET,
        paymentNetwork: this.c.HEDERA_NETWORK,
        estimatedMinutes: "3–15 plus indexing catch-up",
        expiresAt: expires,
        availableSlots: capacity!.count,
        commissioningEnabled: this.c.COMMISSIONING_ENABLED,
        nextAction:
          "Review the exact scope and both prices, then call commission_pipeline with planId and a stable UUID requestId. Payment-enabled MCP clients handle the challenge.",
      };
    });
  }
  async commission(
    planId: string,
    requestId: string,
    meta?: Record<string, unknown>,
  ) {
    if (!this.c.COMMISSIONING_ENABLED)
      throw new Error(
        "Commissioning is disabled until operator setup checks pass",
      );
    const [plan] = await this
      .db`select p.*,q.state,q.definition from graphrail.plans p join graphrail.pipelines q on q.id=p.pipeline_id where p.id=${planId}`;
    if (!plan) throw new Error("Plan not found");
    validateDefinition(plan.definition);
    if (
      plan.state === "awaiting_payment" &&
      new Date(plan.expires_at).getTime() < Date.now()
    )
      throw new Error(
        "Plan expired; call create_pipeline for a new free quote",
      );
    return this.payments.gate(
      {
        kind: "commission",
        pipelineId: plan.pipeline_id,
        amount: plan.commission_amount,
        request: { planId, requestId },
        meta,
      },
      async (_payment, db) => {
        const [job] =
          await db`select id,state from graphrail.jobs where pipeline_id=${plan.pipeline_id}`;
        return {
          pipelineId: plan.pipeline_id,
          jobId: job!.id,
          status: job!.state,
          nextAction:
            "Poll get_pipeline_status; deployment continues on the worker after this MCP connection closes.",
        };
      },
    );
  }
  async status(id: string) {
    const [p] = await this
      .db`select p.*,j.id as job_id,j.state as job_state from graphrail.pipelines p left join graphrail.jobs j on j.pipeline_id=p.id where p.id=${id}`;
    if (!p) throw new Error("Pipeline not found");
    return {
      ...publicPipeline(p),
      jobId: p.job_id,
      jobState: p.job_state,
      errorCode: p.error_code,
      refundStatus:
        p.state === "failed" ? "operator_review_required" : undefined,
    };
  }
  async query(
    pipelineId: string,
    query: string,
    variables: Record<string, unknown>,
    requestId: string,
    meta?: Record<string, unknown>,
  ) {
    const [p] = await this
      .db`select p.*,s.db_schema from graphrail.pipelines p join graphrail.slots s on s.pipeline_id=p.id where p.id=${pipelineId} and p.state='ready'`;
    if (!p) throw new Error("Pipeline is not ready");
    validateDefinition(p.definition);
    validateQuery(query, p.entity_schema, variables);
    // Execute the read before charging; keep it in memory only. Invalid/failed SQL reads cost nothing.
    // Unpaid callers receive a challenge without querying the upstream service.
    return this.payments.gate(
      {
        kind: "query",
        pipelineId,
        amount: p.price,
        request: { query, variables, requestId },
        meta,
      },
      async (_payment, db) => ({
        pipelineId,
        data: await readSql(db, p.db_schema, p.entity_schema, query, variables),
        fetchedAt: new Date().toISOString(),
      }),
    );
  }
  async receipt(paymentId: string) {
    const [p] = await this
      .db`select id,state,settlement from graphrail.payments where id=${paymentId}`;
    if (!p) throw new Error("Receipt not found");
    const [a] = await this
      .db`select state,transaction_id,sequence_number from graphrail.audit where event_key=${`payment:${paymentId}`}`;
    return {
      paymentId,
      status: p.state,
      settlement: p.settlement,
      hcs: a ?? { state: "pending" },
    };
  }
}
