import { setTimeout } from "node:timers/promises";
import { config } from "./config.js";
import { database } from "./db.js";
import { Payments } from "./payments.js";
import { Worker } from "./worker.js";

const c = config();
const db = database(c);
const payments = new Payments(db, c);
await payments.initialize();
const worker = new Worker(db, c, payments);
let running = true;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    running = false;
  });
console.log("GraphRail worker started");
while (running) {
  try {
    await worker.tick();
  } catch {
    console.error(
      "Worker cycle failed; will retry. Check configuration and provider availability.",
    );
  }
  if (running) await setTimeout(c.WORKER_POLL_MS);
}
await db.end();
