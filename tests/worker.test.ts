import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testDB } from "./db-helper.js";
import { Catalog } from "../src/catalog.js";
import { Worker } from "../src/worker.js";
import { Payments } from "../src/payments.js";
import {
  Market,
  publishPackage,
  deploymentRequest,
  deploymentProgress,
} from "../src/deployment.js";
import { run } from "../src/runner.js";
import { generateProject } from "../src/compiler.js";
import { readSql } from "../src/query.js";
import { usdc } from "../examples/usdc.js";
import type { Config } from "../src/config.js";
vi.mock("../src/runner.js", () => ({ run: vi.fn() }));
vi.mock("../src/deployment.js", async () => ({
  ...(await vi.importActual("../src/deployment.js")),
  publishPackage: vi.fn(),
}));
const schema = "gr_00000000000000000000000000000001";
const c = {
  PUBLIC_URL: "http://localhost:3000",
  COMMISSION_AMOUNT: "100000000",
  QUERY_AMOUNT: "100000",
  PAYMENT_ASSET: "0.0.0",
  HEDERA_NETWORK: "hedera:testnet",
  HEDERA_PAY_TO: "0.0.123",
  BLOCKY_FACILITATOR_URL: "https://api.testnet.blocky402.com",
  BUILD_ROOT: "builds/test",
  BUILD_TIMEOUT_MS: 1000,
  OUTPUT_TEST_BLOCKS: 100,
  SUBSTREAMS_BIN: "substreams",
  GRAPH_MARKET_BASE_URL: "https://admin.streamingfast.io",
} as Config;
let f: Awaited<ReturnType<typeof testDB>>,
  cat: Catalog,
  worker: Worker,
  p: any,
  deploy: any,
  state: any;
const fields = {
  block_number: "19000000",
  timestamp: "1700000000",
  transaction_hash: "0x" + "a".repeat(64),
  log_index: "0",
  contract: usdc.contracts[0],
  arg_from: usdc.contracts[0],
  arg_to: usdc.contracts[0],
  arg_value:
    "115792089237316195423570985008687907853269984665640564039457584007913129639935",
};
const output = JSON.stringify({
  tableChanges: [
    {
      table: "transfers",
      pk: `${fields.transaction_hash}-0`,
      operation: "OPERATION_CREATE",
      fields: Object.entries(fields).map(([name, newValue]) => ({
        name,
        newValue,
      })),
    },
  ],
});
beforeEach(async () => {
  f = await testDB();
  const payments = new Payments(f.db, c);
  vi.spyOn(payments, "reconcile").mockResolvedValue(undefined);
  cat = new Catalog(f.db, c, payments);
  worker = new Worker(f.db, c, payments);
  p = await cat.create("Track USDC Transfer events", usdc);
  await f.db`insert into graphrail.slots(id,deployment_id,network,db_schema,postgres_config,secret_ready,pipeline_id) values(${randomUUID()},'hosted-test','mainnet',${schema},${f.db.json({ server: "db.test.supabase.co", port: 5432, user: "postgres", database: "postgres", schema, sslmode: "require" })},true,${p.pipelineId})`;
  await f.db`update graphrail.pipelines set state='queued' where id=${p.pipelineId}`;
  await f.db`insert into graphrail.jobs(id,pipeline_id)values(${randomUUID()},${p.pipelineId})`;
  vi.mocked(run).mockImplementation(async (_bin, args, opts) => {
    if (args[0] === "pack")
      await writeFile(join(opts.cwd, "pipeline.spkg"), "fixture-package");
    return args[0] === "run" ? output : "";
  });
  vi.mocked(publishPackage).mockResolvedValue({
    hash: "a".repeat(64),
    url: "https://test.supabase.co/storage/v1/object/public/packages/a.spkg",
  });
  deploy = vi.spyOn(Market.prototype, "deploy").mockResolvedValue({});
  state = vi.spyOn(Market.prototype, "state").mockResolvedValue({
    deploymentState: {
      replica: "1",
      healthyReplicas: "1",
      executionStates: [{ currentBlock: "19000100", state: "STATE_LIVE" }],
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await f.close();
});
it("builds and deploys asynchronously, lists only flushed data, and serves exact SQL-backed GraphQL", async () => {
  await worker.tick();
  expect(deploy).toHaveBeenCalledOnce();
  expect((await cat.status(p.pipelineId)).status).toBe("indexing");
  expect(await cat.list()).toEqual([]);
  await f.pg.exec(
    `create schema ${schema};revoke all on schema ${schema} from public,anon,authenticated;set search_path to ${schema};${generateProject(usdc)["schema.sql"]};set search_path to public;`,
  );
  await f.pg.query(
    `insert into ${schema}.transfers values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      `${fields.transaction_hash}-0`,
      fields.block_number,
      fields.timestamp,
      fields.transaction_hash,
      fields.log_index,
      fields.contract,
      fields.arg_from,
      fields.arg_to,
      fields.arg_value,
    ],
  );
  await f.db`update graphrail.pipelines set deployment_checked_at=null where id=${p.pipelineId}`;
  await worker.indexing();
  expect((await cat.status(p.pipelineId)).status).toBe("ready");
  expect(await cat.list()).toHaveLength(1);
  const result = (await readSql(
    f.db,
    schema,
    p.schema,
    '{ transfers(first:1,where:{blockNumber_gte:"19000000"}) { id arg_value blockNumber } }',
  )) as any;
  expect(result.transfers[0].arg_value).toBe(fields.arg_value);
  expect(result.transfers[0].blockNumber).toBe(fields.block_number);
  const attack = (await readSql(
    f.db,
    schema,
    p.schema,
    "query($id:ID!){transfer(id:$id){id}}",
    { id: "' OR 1=1 --" },
  )) as any;
  expect(attack.transfer).toBeNull();
  await expect(
    readSql(f.db, "public;drop schema graphrail", p.schema, "{transfers{id}}"),
  ).rejects.toThrow("schema");
  const perms = await f.pg.query(
    `select has_schema_privilege('anon','${schema}','USAGE') as access`,
  );
  expect(perms.rows[0]).toEqual({ access: false });
});
it("rejects empty live output before publishing or deploying", async () => {
  vi.mocked(run).mockResolvedValue("{}");
  await worker.tick();
  expect((await cat.status(p.pipelineId)).errorCode).toBe("TESTING_FAILED");
  expect(deploy).not.toHaveBeenCalled();
});
it("keeps an uncertain deployment for reconciliation without submitting twice", async () => {
  deploy.mockRejectedValue(new Error("timeout"));
  state.mockResolvedValue({ deploymentState: {} });
  await worker.tick();
  expect((await cat.status(p.pipelineId)).status).toBe("deploying");
  await worker.tick();
  expect(deploy).toHaveBeenCalledOnce();
});
it("uses the official stored-secret SQL request and never forwards a password", () => {
  const request = deploymentRequest(
    {
      hosted_id: "real-provider-id",
      pipeline_id: p.pipelineId,
      secret_ready: true,
      db_schema: schema,
      postgres_config: {
        server: "db.test.supabase.co",
        port: 5432,
        user: "postgres",
        database: "postgres",
        schema,
        sslmode: "require",
        password: "must-not-leak",
      },
    },
    usdc,
    "https://test.supabase.co/a.spkg",
  );
  expect(
    request.deployment_request.sink_sql_deployment.execution_config
      .output_module,
  ).toBe("db_out");
  expect(JSON.stringify(request)).not.toContain("password");
  expect(request.use_stored_secret).toBe(true);
  expect(
    deploymentProgress({
      deploymentState: { deploymentState: "DEPLOYMENT_STATE_ERROR" },
    }).failed,
  ).toBe(true);
});
