import { config } from "./config.js";
import { database } from "./db.js";
import { Payments } from "./payments.js";
import { Catalog } from "./catalog.js";
import { createApp } from "./server.js";

const c = config();
const db = database(c);
await db`select 1 from graphrail.pipelines limit 1`;
const payments = new Payments(db, c);
await payments.initialize();
const app = createApp(c, new Catalog(db, c, payments));
const server = app.listen(c.PORT, c.HOST, () =>
  console.log(`GraphRail MCP listening at ${c.PUBLIC_URL}/mcp`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close(() => {
      void db.end().then(() => process.exit(0));
    });
  });
