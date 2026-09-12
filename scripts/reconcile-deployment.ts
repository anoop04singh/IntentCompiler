import { config } from "../src/config.js";
import { database } from "../src/db.js";
import { Market, deploymentProgress } from "../src/deployment.js";
import { z } from "zod";
const c = config(),
  db = database(c),
  market = new Market(db, c);
const id = z.string().uuid().parse(process.argv[2]);
try {
  const [p] =
    await db`select p.*,s.deployment_id as hosted_id,s.db_schema,s.postgres_config,s.secret_ready from graphrail.pipelines p join graphrail.slots s on s.pipeline_id=p.id where p.id=${id}`;
  if (!p?.package_url || !["deploying", "failed", "indexing"].includes(p.state))
    throw new Error("No pending hosted deployment to reconcile");
  const progress = deploymentProgress(await market.state(p.hosted_id));
  if (progress.failed)
    throw new Error(
      "Provider reports a failed/deleted runner. Repair it in The Graph Market before resuming.",
    );
  if (!progress.active) {
    if (process.argv[3] !== "--retry-unsubmitted")
      throw new Error(
        "Provider shows no runner. Check the deployment in The Graph Market; if the submission did not occur, rerun with --retry-unsubmitted. This can start billable compute.",
      );
    if (
      p.state !== "deploying" ||
      Date.now() - new Date(p.updated_at).getTime() < 600000
    )
      throw new Error(
        "Allow at least 10 minutes for deployment reconciliation before retrying an unsubmitted request",
      );
    await market.deploy(p, p.definition, p.package_url);
  }
  await db`update graphrail.pipelines set state='indexing',error_code=null,deployment_checked_at=null,updated_at=now() where id=${id}`;
  console.log(
    "Deployment reconciled; worker will recheck indexing readiness. No new commissioning payment.",
  );
} finally {
  await db.end();
}
