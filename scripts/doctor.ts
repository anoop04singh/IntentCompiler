import "dotenv/config";
import { spawnSync } from "node:child_process";
import { database } from "../src/db.js";
import { Market } from "../src/deployment.js";
const required = [
  "DATABASE_URL",
  "HEDERA_PAY_TO",
  "HEDERA_OPERATOR_ID",
  "HEDERA_OPERATOR_KEY",
  "HEDERA_HCS_TOPIC_ID",
  "SUBSTREAMS_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
let missing = false;
for (const name of required) {
  const present = Boolean(process.env[name]);
  console.log(`${present ? "OK" : "MISSING"} ${name}`);
  if (!present) missing = true;
}
for (const binary of [
  "cargo",
  process.env.SUBSTREAMS_BIN || "substreams",
  "protoc",
  "buf",
]) {
  const r = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  const ok = r.status === 0;
  console.log(`${ok ? "OK" : "MISSING"} ${binary}`);
  if (!ok) missing = true;
}
if (process.env.DATABASE_URL) {
  const db = database({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL !== "false",
  });
  try {
    const [row] =
      await db`select count(*)::int as count from graphrail.slots where pipeline_id is null and secret_ready=true`;
    console.log(`OK Supabase; ${row!.count} prepared hosted slots`);
    if (!row!.count) missing = true;
    await new Market(db, {
      GRAPH_MARKET_BASE_URL:
        process.env.GRAPH_MARKET_BASE_URL || "https://admin.streamingfast.io",
    }).auth();
    console.log("OK Market session is available");
  } catch {
    console.log(
      "FAILED Supabase schema/capacity or Market login; check db:migrate, setup:market and setup:slot",
    );
    missing = true;
  } finally {
    await db.end();
  }
}
try {
  const r = await fetch(
    (process.env.BLOCKY_FACILITATOR_URL ||
      "https://api.testnet.blocky402.com") + "/supported",
    { signal: AbortSignal.timeout(15000) },
  );
  const body = (await r.json()) as any;
  const kind = body.kinds?.find(
    (k: any) =>
      k.network === "hedera:testnet" &&
      k.scheme === "exact" &&
      k.x402Version === 2,
  );
  if (!kind?.extra?.feePayer) throw new Error();
  console.log("OK Blocky advertises Hedera testnet fee-payer sponsorship");
} catch {
  console.log("FAILED Blocky Hedera support check");
  missing = true;
}
console.log(
  missing
    ? "Setup is incomplete. Live deployment has not been verified."
    : "Checks passed. Set COMMISSIONING_ENABLED=true and start the API and worker.",
);
process.exitCode = missing ? 1 : 0;
