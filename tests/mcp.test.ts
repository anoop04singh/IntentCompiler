import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/server.js";
import type { Config } from "../src/config.js";
import type { Catalog } from "../src/catalog.js";

it("serves tools and skills to a real remote MCP client", async () => {
  const c = {
    PUBLIC_URL: "http://127.0.0.1:31573",
    PORT: 31573,
    ALLOWED_ORIGINS: "http://127.0.0.1:31573",
    COMMISSIONING_ENABLED: false,
  } as Config;
  const catalog = {
    c,
    list: async () => [],
    create: async () => ({ status: "needs_definition" }),
  } as unknown as Catalog;
  const server = createApp(c, catalog).listen(31573, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const client = new Client({ name: "test-agent", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(c.PUBLIC_URL + "/mcp")),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "create_pipeline",
        "commission_pipeline",
        "list_pipelines",
        "get_pipeline_status",
        "query_pipeline",
        "get_payment_receipt",
      ]),
    );
    const r = await client.callTool({ name: "list_pipelines", arguments: {} });
    expect(r.isError).toBe(false);
    const resource = await client.readResource({
      uri: "graphrail://skills/workflow",
    });
    expect(resource.contents[0]).toHaveProperty("text");
    const denied = await fetch(c.PUBLIC_URL + "/mcp", {
      method: "POST",
      headers: {
        Origin: "https://evil.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(denied.status).toBe(403);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}, 15000);
