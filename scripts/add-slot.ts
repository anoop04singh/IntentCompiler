import "dotenv/config";
import { randomUUID } from "node:crypto";
import { database } from "../src/db.js";
import { Market } from "../src/deployment.js";
import { identifier } from "../src/query.js";
import { z } from "zod";
const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    SINK_DB_HOST: z.string().min(1),
    SINK_DB_PORT: z.coerce.number().int().default(5432),
    SINK_DB_USER: z.string().min(1),
    SINK_DB_NAME: z.string().default("postgres"),
    SINK_NETWORK: z.literal("sepolia").default("sepolia"),
  })
  .parse(process.env);
const db = database({
  DATABASE_URL: env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL !== "false",
});
const market = new Market(db, {
  GRAPH_MARKET_BASE_URL:
    process.env.GRAPH_MARKET_BASE_URL || "https://admin.streamingfast.io",
});
try {
  if (process.argv[2] === "create") {
    if (env.SINK_DB_PORT !== 5432)
      throw new Error("Use the Supabase direct or session pooler port 5432");
    if (
      !env.SINK_DB_HOST.endsWith(".supabase.co") &&
      !env.SINK_DB_HOST.endsWith(".supabase.com")
    )
      throw new Error("Use your Supabase database host");
    const dbUrl = new URL(env.DATABASE_URL);
    if (
      decodeURIComponent(dbUrl.username) !== env.SINK_DB_USER ||
      dbUrl.hostname !== env.SINK_DB_HOST ||
      decodeURIComponent(dbUrl.pathname.slice(1)) !== env.SINK_DB_NAME
    )
      throw new Error(
        "Use the same Supabase host and database for the sink and GraphRail",
      );
    const id = randomUUID(),
      schema = `gr_${id.replaceAll("-", "")}`;
    const result = await market.call("CreateDeployment");
    const deploymentId = result.deploymentId;
    if (typeof deploymentId !== "string" || !deploymentId)
      throw new Error("Market did not return a deployment ID");
    const pg = {
      server: env.SINK_DB_HOST,
      port: env.SINK_DB_PORT,
      user: env.SINK_DB_USER,
      database: env.SINK_DB_NAME,
      schema,
      sslmode: "require",
    };
    await db.begin(async (tx) => {
      await tx.unsafe(
        `CREATE SCHEMA ${identifier(schema)}; REVOKE ALL ON SCHEMA ${identifier(schema)} FROM PUBLIC, anon, authenticated;`,
      );
      await tx`insert into graphrail.slots(id,deployment_id,network,db_schema,postgres_config)values(${id},${deploymentId},${env.SINK_NETWORK},${schema},${tx.json(pg)})`;
    });
    console.log(
      `Created slot ${id}. Save its database password at https://thegraph.market/sinks/${encodeURIComponent(deploymentId)}/secret?output=postgres\nThen run npm run setup:slot -- confirm-secret ${id}`,
    );
  } else if (process.argv[2] === "confirm-secret") {
    const id = z.string().uuid().parse(process.argv[3]);
    const [slot] =
      await db`select * from graphrail.slots where id=${id} and pipeline_id is null`;
    if (!slot) throw new Error("Unused slot not found");
    const result = await market.call("HasDeploymentSecret", {
      deployment_id: slot.deployment_id,
      key: "postgres_password",
    });
    if (!result.exists)
      throw new Error("Save the password on the secret page before confirming");
    await db`update graphrail.slots set secret_ready=true where id=${id}`;
    console.log("Secret confirmed; slot can accept one paid pipeline.");
  } else
    throw new Error(
      "Usage: npm run setup:slot -- create | confirm-secret <slot-id>",
    );
} finally {
  await db.end();
}
