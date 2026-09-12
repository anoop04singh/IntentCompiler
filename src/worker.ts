import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  Client,
  PrivateKey,
  TopicMessageSubmitTransaction,
  TransactionId,
  AccountId,
} from "@hiero-ledger/sdk";
import type { DB, Row } from "./db.js";
import type { Config } from "./config.js";
import { generateProject, writeProject } from "./compiler.js";
import { validateDefinition, digest } from "./spec.js";
import { run } from "./runner.js";
import { checkOutput } from "./output-check.js";
import { identifier } from "./query.js";
import { Market, publishPackage, deploymentProgress } from "./deployment.js";
import { snake } from "./spec.js";
import type { Payments } from "./payments.js";

export class Worker {
  readonly id = randomUUID();
  constructor(
    readonly db: DB,
    readonly c: Config,
    readonly payments: Payments,
  ) {}
  async tick() {
    await this.payments
      .reconcile()
      .catch(() => console.error("Payment reconciliation deferred"));
    await this.audit().catch(() =>
      console.error("HCS audit submission deferred"),
    );
    // A crashed build is safe to repeat: same generated source and deterministic version.
    const [job] = await this
      .db`update graphrail.jobs set lease_owner=${this.id},lease_until=now()+interval '2 minutes',state='running',attempts=attempts+1
      where id=(select id from graphrail.jobs where (state='queued' or (state='running' and lease_until<now())) and attempts<3 order by created_at for update skip locked limit 1) returning *`;
    if (job) await this.build(job);
    await this
      .db`update graphrail.pipelines set state='failed',error_code='WORKER_RETRY_LIMIT',updated_at=now() where id in (select pipeline_id from graphrail.jobs where state='running' and lease_until<now() and attempts>=3)`;
    await this.indexing();
  }
  async build(job: Row) {
    const abort = new AbortController();
    let busy = false;
    const heartbeat = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const rows = await this
          .db`update graphrail.jobs set lease_until=now()+interval '2 minutes' where id=${job.id} and lease_owner=${this.id} returning id`;
        if (!rows.length) abort.abort();
      } catch {
        abort.abort();
      } finally {
        busy = false;
      }
    }, 20000);
    const root = join(resolve(this.c.BUILD_ROOT), job.pipeline_id);
    let stage = "building";
    try {
      const [p] = await this
        .db`select p.*,s.deployment_id as hosted_id,s.db_schema,s.postgres_config,s.secret_ready from graphrail.pipelines p join graphrail.slots s on s.pipeline_id=p.id where p.id=${job.pipeline_id}`;
      if (!p) throw new Error("Missing deployment slot");
      if (
        ["deploying", "indexing", "ready"].includes(p.state) &&
        p.package_url
      ) {
        await this.finish(job);
        return;
      }
      const definition = validateDefinition(p.definition);
      await this.stage(p.id, stage, job.id);
      await mkdir(root, { recursive: true });
      await writeProject(root, generateProject(definition));
      // Generated trusted templates only; no caller-supplied shell, Rust, Cargo dependency, or path.
      // Build tools receive no DB, Hedera, hosted-provider or payment secrets.
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        SYSTEMROOT: process.env.SYSTEMROOT,
        SystemDrive: process.env.SystemDrive,
        ProgramFiles: process.env.ProgramFiles,
        "ProgramFiles(x86)": process.env["ProgramFiles(x86)"],
        ProgramW6432: process.env.ProgramW6432,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        INCLUDE: process.env.INCLUDE,
        LIB: process.env.LIB,
        LIBPATH: process.env.LIBPATH,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        CARGO_HOME: process.env.CARGO_HOME,
        RUSTUP_HOME: process.env.RUSTUP_HOME,
        PROTOC: process.env.PROTOC,
      };
      const opts = {
        cwd: root,
        env,
        timeoutMs: this.c.BUILD_TIMEOUT_MS,
        signal: abort.signal,
        logPath: join(root, "build.log"),
      };
      await run("cargo", ["test", "--quiet"], opts);
      await run(
        "cargo",
        ["build", "--release", "--target", "wasm32-unknown-unknown"],
        opts,
      );
      await run(
        this.c.SUBSTREAMS_BIN,
        ["pack", "substreams.yaml", "-o", "pipeline.spkg"],
        opts,
      );
      stage = "testing";
      await this.stage(p.id, stage, job.id);
      const output = await run(
        this.c.SUBSTREAMS_BIN,
        [
          "run",
          "pipeline.spkg",
          "db_out",
          "--network",
          definition.network,
          "-e",
          this.c.SUBSTREAMS_ENDPOINT ?? "sepolia.eth.streamingfast.io:443",
          "-s",
          String(definition.testStartBlock),
          "-t",
          `+${this.c.OUTPUT_TEST_BLOCKS}`,
          "-o",
          "jsonl",
        ],
        {
          ...opts,
          env: { ...env, SUBSTREAMS_API_KEY: this.c.SUBSTREAMS_API_KEY },
        },
      );
      const verification = checkOutput(
        output,
        definition,
        this.c.OUTPUT_TEST_BLOCKS,
      );
      await writeFile(
        join(root, "verification.json"),
        JSON.stringify(verification, null, 2),
      );
      const artifact = await publishPackage(
        this.c,
        await readFile(join(root, "pipeline.spkg")),
      );
      // Persist intent before the provider call. An ambiguous response is reconciled, never blindly resubmitted.
      await this
        .db`update graphrail.pipelines set package_hash=${artifact.hash},package_url=${artifact.url},deployment_id=${p.hosted_id} where id=${p.id}`;
      stage = "deploying";
      await this.stage(p.id, stage, job.id);
      try {
        await new Market(this.db, this.c).deploy(p, definition, artifact.url);
        await this.stage(p.id, "indexing", job.id);
      } catch {
        await this
          .db`update graphrail.pipelines set error_code='DEPLOYMENT_RECONCILIATION_REQUIRED' where id=${p.id}`;
      }
      await this.finish(job);
    } catch {
      if (!abort.signal.aborted) {
        await this
          .db`update graphrail.pipelines set state='failed',error_code=${`${stage.toUpperCase()}_FAILED`},updated_at=now() where id=${job.pipeline_id} and exists(select 1 from graphrail.jobs where id=${job.id} and lease_owner=${this.id})`;
        await this
          .db`update graphrail.jobs set state='failed',lease_until=null where id=${job.id} and lease_owner=${this.id}`;
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
  async stage(pipelineId: string, state: string, jobId: string) {
    const rows = await this
      .db`update graphrail.pipelines set state=${state},updated_at=now() where id=${pipelineId} and exists(select 1 from graphrail.jobs where id=${jobId} and lease_owner=${this.id} and lease_until>now()) returning id`;
    if (!rows.length) throw new Error("Worker lease lost");
  }
  async finish(job: Row) {
    await this
      .db`update graphrail.jobs set state='complete',lease_until=null where id=${job.id} and lease_owner=${this.id}`;
  }
  async indexing() {
    const pipelines = await this
      .db`select p.*,s.db_schema from graphrail.pipelines p join graphrail.slots s on s.pipeline_id=p.id where p.state in ('deploying','indexing','ready') and (p.deployment_checked_at is null or p.deployment_checked_at<now()-interval '30 seconds') limit 50`;
    for (const p of pipelines) {
      await this
        .db`update graphrail.pipelines set deployment_checked_at=now() where id=${p.id}`;
      try {
        const progress = deploymentProgress(
          await new Market(this.db, this.c).state(p.deployment_id),
        );
        if (progress.failed) {
          await this
            .db`update graphrail.pipelines set state='failed',error_code='INDEXING_ERROR',updated_at=now() where id=${p.id}`;
          continue;
        }
        if (!progress.active) {
          if (p.state === "ready")
            await this
              .db`update graphrail.pipelines set state='indexing',error_code='HOSTED_RUNNER_INACTIVE' where id=${p.id}`;
          continue;
        }
        let ready =
          progress.healthy &&
          progress.indexedBlock >=
            p.definition.testStartBlock + this.c.OUTPUT_TEST_BLOCKS - 1;
        if (ready)
          for (const event of p.definition.events) {
            const [row] = await this.db.unsafe(
              `select exists(select 1 from ${identifier(p.db_schema)}.${identifier(snake(event.name) + "s")} where block_number >= $1 and block_number < $2) as present`,
              [
                p.definition.testStartBlock,
                p.definition.testStartBlock + this.c.OUTPUT_TEST_BLOCKS,
              ],
            );
            if (!row?.present) ready = false;
          }
        await this
          .db`update graphrail.pipelines set state=${ready ? "ready" : "indexing"},indexed_block=${progress.indexedBlock},error_code=null,updated_at=now() where id=${p.id}`;
        if (ready) {
          const payload = {
            type: "pipeline_registered",
            pipelineId: p.id,
            packageHash: p.package_hash,
            specHash: digest(p.definition),
          };
          await this
            .db`insert into graphrail.audit(id,event_key,payload) values (${randomUUID()},${`pipeline:${p.id}`},${this.db.json(payload)}) on conflict(event_key) do nothing`;
        }
      } catch {
        // Fail closed on lost provider/DB access: paid queries are disabled until health returns.
        if (p.state === "ready")
          await this
            .db`update graphrail.pipelines set state='indexing',error_code='HEALTH_CHECK_DEFERRED' where id=${p.id}`;
      }
    }
  }
  async audit() {
    if (!this.c.HEDERA_HCS_TOPIC_ID || !this.c.HEDERA_OPERATOR_KEY) return;
    const client = Client.forTestnet().setOperator(
      this.c.HEDERA_OPERATOR_ID,
      PrivateKey.fromString(this.c.HEDERA_OPERATOR_KEY),
    );
    try {
      const [entry] = await this
        .db`update graphrail.audit set next_attempt_at=now()+interval '2 minutes',attempts=attempts+1 where id=(select id from graphrail.audit where state='pending' and next_attempt_at<now() order by created_at for update skip locked limit 1) returning *`;
      if (!entry) return;
      const message = JSON.stringify({ v: 1, id: entry.id, ...entry.payload });
      if (Buffer.byteLength(message) > 1000)
        throw new Error("HCS audit exceeds one message");
      const transactionId = TransactionId.generate(
        AccountId.fromString(this.c.HEDERA_OPERATOR_ID),
      );
      const response = await new TopicMessageSubmitTransaction()
        .setTopicId(this.c.HEDERA_HCS_TOPIC_ID)
        .setTransactionId(transactionId)
        .setMessage(message)
        .execute(client);
      const receipt = await response.getReceipt(client);
      await this
        .db`update graphrail.audit set state='recorded',transaction_id=${response.transactionId.toString()},sequence_number=${receipt.topicSequenceNumber!.toString()} where id=${entry.id}`;
      // HCS delivery is at least once across crashes; consumers deduplicate by the stable audit id.
    } finally {
      client.close();
    }
  }
}
