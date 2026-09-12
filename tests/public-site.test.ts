import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { testDB } from "./db-helper.js";
import { Catalog } from "../src/catalog.js";
import { Payments } from "../src/payments.js";
import { createApp } from "../src/server.js";
import type { Config } from "../src/config.js";
import { usdc } from "../examples/usdc.js";

it("publishes only ready services and settled aggregates, serves the landing page and hides secrets", async () => {
  const fixture = await testDB();
  const c = {
    PUBLIC_URL: "http://127.0.0.1:31574",
    PORT: 31574,
    ALLOWED_ORIGINS: "http://127.0.0.1:31574",
    COMMISSION_AMOUNT: "100000000",
    QUERY_AMOUNT: "100000",
    PAYMENT_ASSET: "0.0.0",
    HEDERA_NETWORK: "hedera:testnet",
    HEDERA_PAY_TO: "0.0.123",
    BLOCKY_FACILITATOR_URL: "https://api.testnet.blocky402.com",
    COMMISSIONING_ENABLED: false,
  } as Config;
  const catalog = new Catalog(fixture.db, c, new Payments(fixture.db, c));
  const plan = (await catalog.create("Private failed intent", usdc)) as any;
  for (const [state, kind, amount] of [
    ["settled", "commission", "100000000"],
    ["failed", "commission", "900000000"],
    ["verifying", "query", "100000"],
  ]) {
    await fixture.db`insert into graphrail.payments(id,transaction_key,request_hash,kind,pipeline_id,state,requirements,payload) values(${randomUUID()},${randomUUID()},'private',${kind},${plan.pipelineId},${state},${fixture.db.json({ amount, asset: "0.0.0" })},${fixture.db.json({ secret: "NEVER_PUBLIC" })})`;
  }
  const server = createApp(c, catalog).listen(31574, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const config = await (
      await fetch(c.PUBLIC_URL + "/api/public/config")
    ).json();
    expect(config.mcpUrl).toBe(c.PUBLIC_URL + "/mcp");
    expect(config.commissioningEnabled).toBe(false);
    const stats = await (
      await fetch(c.PUBLIC_URL + "/api/public/stats")
    ).json();
    expect(stats).toMatchObject({
      readyPipelines: 0,
      commissions: 1,
      paidQueries: 0,
      settledAmount: "100000000",
      pipelines: [],
    });
    expect(JSON.stringify(stats)).not.toMatch(
      /NEVER_PUBLIC|Private failed intent|requirements|payload|postgres/,
    );
    expect(await (await fetch(c.PUBLIC_URL)).text()).toContain("Onchain data.");
    expect((await fetch(c.PUBLIC_URL + "/setup.md")).status).toBe(200);
    expect((await fetch(c.PUBLIC_URL + "/.env")).status).toBe(404);
    expect(
      (
        await fetch(c.PUBLIC_URL + "/api/public/stats", {
          headers: { Origin: "https://untrusted.invalid" },
        })
      ).status,
    ).toBe(403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await fixture.close();
  }
});

it("returns unavailable rather than fake zero statistics when the database fails", async () => {
  const c = {
    PUBLIC_URL: "http://127.0.0.1:31575",
    PORT: 31575,
    ALLOWED_ORIGINS: "http://127.0.0.1:31575",
  } as Config;
  const catalog = {
    c,
    db: async () => {
      throw new Error("private connection details");
    },
  } as unknown as Catalog;
  const server = createApp(c, catalog).listen(31575, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const response = await fetch(c.PUBLIC_URL + "/api/public/stats");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Live statistics are temporarily unavailable",
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
