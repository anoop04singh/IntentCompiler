import "dotenv/config";
import { z } from "zod";
import { database } from "../src/db.js";
const pipelineId = z.string().uuid().parse(process.argv[2]);
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL");
const db = database({
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL !== "false",
});
try {
  await db.begin(async (tx) => {
    const [p] =
      await tx`select id,package_url from graphrail.pipelines where id=${pipelineId} and state='failed' for update`;
    if (!p) throw new Error("Only failed pipelines can be retried");
    if (p.package_url)
      throw new Error(
        "Package was submitted or prepared for hosted deployment; reconcile with Market before retrying to avoid resetting indexed data",
      );
    const [paid] =
      await tx`select id from graphrail.payments where pipeline_id=${pipelineId} and kind='commission' and state='settled'`;
    if (!paid)
      throw new Error(
        "No settled commissioning receipt; do not bypass the payment gate",
      );
    await tx`update graphrail.jobs set state='queued',attempts=0,lease_owner=null,lease_until=null where pipeline_id=${pipelineId}`;
    await tx`update graphrail.pipelines set state='queued',error_code=null,updated_at=now() where id=${pipelineId}`;
  });
  console.log("Paid job requeued. No new payment requested.");
} finally {
  await db.end();
}
