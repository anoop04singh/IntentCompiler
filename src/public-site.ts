import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { resolve } from "node:path";
import type { Catalog } from "./catalog.js";

export function mountPublicSite(app: Express, catalog: Catalog) {
  const c = catalog.c;
  const mcpUrl = new URL("/mcp", c.PUBLIC_URL).href;
  app.use(
    "/api/public",
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.get("/api/public/config", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      mcpUrl,
      transport: "Streamable HTTP",
      chain: "sepolia",
      paymentNetwork: c.HEDERA_NETWORK,
      asset: c.PAYMENT_ASSET,
      commissionAmount: c.COMMISSION_AMOUNT,
      queryAmount: c.QUERY_AMOUNT,
      commissioningEnabled: c.COMMISSIONING_ENABLED,
      temporaryEndpoint: new URL(mcpUrl).hostname.endsWith(
        ".trycloudflare.com",
      ),
    });
  });
  let cached: { value: unknown; expires: number } | undefined;
  let pending: Promise<unknown> | undefined;
  async function snapshot() {
    const [row] = await catalog.db`
      select
        (select count(*)::int from graphrail.pipelines where state='ready') as ready,
        (select count(*)::int from graphrail.payments where state='settled' and kind='commission') as commissions,
        (select count(*)::int from graphrail.payments where state='settled' and kind='query') as queries,
        (select count(*)::int from graphrail.audit where state='recorded') as receipts,
        (select coalesce(sum((requirements->>'amount')::numeric),0)::text from graphrail.payments where state='settled' and requirements->>'asset'=${c.PAYMENT_ASSET}) as volume`;
    // Explicit projection: no wallet payloads, private schemas, keys or failed build details.
    return {
      updatedAt: new Date().toISOString(),
      readyPipelines: row!.ready,
      commissions: row!.commissions,
      paidQueries: row!.queries,
      hcsReceipts: row!.receipts,
      settledAmount: row!.volume,
      asset: c.PAYMENT_ASSET,
      commissioningEnabled: c.COMMISSIONING_ENABLED,
      pipelines: (await catalog.list()).map((p) => ({
        pipelineId: p.pipelineId,
        description: p.description,
        chain: p.chain,
        pricePerQuery: p.pricePerQuery,
        events: p.events.map((e: { name: string }) => e.name),
        indexedBlock: p.indexedBlock,
      })),
    };
  }
  app.get("/api/public/stats", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!cached || cached.expires < Date.now()) {
        pending ??= snapshot()
          .then((value) => {
            cached = { value, expires: Date.now() + 15000 };
            return value;
          })
          .finally(() => {
            pending = undefined;
          });
        await pending;
      }
      res.json(cached!.value);
    } catch {
      res
        .status(503)
        .json({ error: "Live statistics are temporarily unavailable" });
    }
  });
  app.use(
    express.static(resolve("public"), {
      dotfiles: "deny",
      maxAge: 0,
      setHeaders(res) {
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    }),
  );
}
