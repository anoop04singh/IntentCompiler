import express from "express";
import rateLimit from "express-rate-limit";
import { readFile, readdir } from "node:fs/promises";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Catalog } from "./catalog.js";
import { definitionSchema } from "./spec.js";
import { result } from "./payments.js";

export function createMcp(catalog: Catalog) {
  const mcp = new McpServer(
    { name: "GraphRail", version: "0.1.0" },
    {
      instructions:
        "Agent marketplace: services register, agents discover and pay. Start with create_pipeline. Read graphrail://skills/workflow. No hosted LLM API key is required. Never send wallet private keys to tools.",
    },
  );
  const uuid = z.string().uuid();
  const free = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  mcp.registerTool(
    "create_pipeline",
    {
      description:
        "FREE: search for reusable pipelines, then quote a typed EVM pipeline from an agent-supplied definition. Prompt-only calls return candidates and the next planning step.",
      inputSchema: {
        prompt: z.string().min(8).max(4000),
        definition: definitionSchema.optional(),
      },
      annotations: { ...free, readOnlyHint: false },
    },
    async (a) => result(await catalog.create(a.prompt, a.definition)),
  );
  mcp.registerTool(
    "list_pipelines",
    {
      description:
        "FREE: discover ready pipelines, their exact coverage, GraphQL entity schemas and atomic-unit query prices.",
      inputSchema: { keyword: z.string().max(200).optional() },
      annotations: free,
    },
    async (a) =>
      result({
        pipelines: await catalog.list(a.keyword),
        paymentNetwork: catalog.c.HEDERA_NETWORK,
        asset: catalog.c.PAYMENT_ASSET,
      }),
  );
  mcp.registerTool(
    "commission_pipeline",
    {
      description:
        "PAID: settle the commissioning fee on Hedera via Blocky, enqueue a durable deployment job and return immediately. Use a stable UUID requestId for retries.",
      inputSchema: { planId: uuid, requestId: uuid },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (a, extra) => catalog.commission(a.planId, a.requestId, extra._meta),
  );
  mcp.registerTool(
    "get_pipeline_status",
    {
      description:
        "FREE: poll asynchronous build, testing, deployment and indexing. Only ready pipelines can be purchased.",
      inputSchema: { pipelineId: uuid },
      annotations: free,
    },
    async (a) => result(await catalog.status(a.pipelineId)),
  );
  mcp.registerTool(
    "query_pipeline",
    {
      description:
        "PAID: one bounded GraphQL read of a ready pipeline. A new requestId and payment are required per query. Returned data is not cached in GraphRail.",
      inputSchema: {
        pipelineId: uuid,
        query: z.string().min(1).max(16000),
        variables: z.record(z.unknown()).default({}),
        requestId: uuid,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (a, extra) =>
      catalog.query(
        a.pipelineId,
        a.query,
        a.variables,
        a.requestId,
        extra._meta,
      ),
  );
  mcp.registerTool(
    "get_payment_receipt",
    {
      description:
        "FREE: get settlement and the eventual HCS receipt for a paymentId.",
      inputSchema: { paymentId: uuid },
      annotations: free,
    },
    async (a) => result(await catalog.receipt(a.paymentId)),
  );
  mcp.registerTool(
    "search_substreams_packages",
    {
      description:
        "FREE: search the official Substreams registry before designing a new package. Registry suggestions are not GraphRail paid services.",
      inputSchema: { keyword: z.string().min(2).max(100) },
      annotations: { ...free, openWorldHint: true },
    },
    async (a) => {
      const url = new URL("https://substreams.dev/v1/registry/packages");
      url.searchParams.set("query", a.keyword);
      url.searchParams.set("page_size", "5");
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!response.ok)
        throw new Error(
          `Registry unavailable (HTTP ${response.status}); retry later`,
        );
      const body = (await response.json()) as any;
      return result({
        packages: body.packages ?? [],
        hasMore: body.hasMore ?? false,
      });
    },
  );
  mcp.registerResource(
    "skill-reference",
    new ResourceTemplate("graphrail://skills/references/{name}", {
      list: async () => ({
        resources: (await readdir("skills/references"))
          .filter((n) => n.endsWith(".md"))
          .map((name) => ({
            name,
            uri: `graphrail://skills/references/${name}`,
            mimeType: "text/markdown",
          })),
      }),
    }),
    { mimeType: "text/markdown" },
    async (uri, { name }) => {
      if (typeof name !== "string" || !/^[-a-z0-9]+\.md$/.test(name))
        throw new Error("Unknown skill reference");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: await readFile(`skills/references/${name}`, "utf8"),
          },
        ],
      };
    },
  );
  for (const name of [
    "workflow",
    "substreams-dev",
    "substreams-ethereum",
    "substreams-testing",
    "substreams-sql",
    "substreams-hosted-sink",
    "thegraph-market-api",
  ]) {
    mcp.registerResource(
      name,
      `graphrail://skills/${name}`,
      {
        mimeType: "text/markdown",
        description: `GraphRail agent guidance: ${name}`,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: await readFile(
              new URL(
                `../../skills/${name}.md`,
                import.meta.url,
              ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
              "utf8",
            ).catch(() => readFile(`skills/${name}.md`, "utf8")),
          },
        ],
      }),
    );
  }
  mcp.registerPrompt(
    "build_pipeline",
    {
      description:
        "Drive the complete intent-to-marketplace workflow using the connected agent.",
      argsSchema: { intent: z.string() },
    },
    async (a) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read graphrail://skills/workflow, then execute it for this intent: ${a.intent}. Show the quote before payment and poll the deployment until ready. Follow my existing spending authorization.`,
          },
        },
      ],
    }),
  );
  return mcp;
}
export function createApp(c: Config, catalog: Catalog) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  const allowed = new Set(c.ALLOWED_ORIGINS.split(",").map((s) => s.trim()));
  const hosts = new Set([
    new URL(c.PUBLIC_URL).host,
    `localhost:${c.PORT}`,
    `127.0.0.1:${c.PORT}`,
  ]);
  app.use((req, res, next) => {
    if (!hosts.has(req.headers.host ?? "")) {
      res.status(403).json({ error: "Invalid host" });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Accept,MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({
      service: "GraphRail",
      status: "ok",
      commissioningEnabled: c.COMMISSIONING_ENABLED,
    }),
  );
  app.use(
    "/mcp",
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.post("/mcp", async (req, res) => {
    const mcp = createMcp(catalog);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: { code: -32603, message: "GraphRail request failed" },
        });
    }
  });
  app.all("/mcp", (_req, res) =>
    res.status(405).set("Allow", "POST,OPTIONS").end(),
  );
  return app;
}
