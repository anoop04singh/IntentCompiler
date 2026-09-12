import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Free connection check: no buyer key, payment signing or commissioning.
const endpoint = new URL(
  "/mcp",
  process.env.PUBLIC_URL || "http://localhost:3000",
);
const client = new Client({ name: "graphrail-discovery", version: "1.0.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  console.log("Connected:", endpoint.href);
  console.log(
    "Tools:",
    (await client.listTools()).tools.map((tool) => tool.name),
  );
  const workflow = await client.readResource({
    uri: "graphrail://skills/workflow",
  });
  console.log("Workflow available:", workflow.contents.length > 0);
  const response = await client.callTool({
    name: "list_pipelines",
    arguments: {},
  });
  if (response.isError) throw new Error("Discovery call failed");
  console.log(
    "Catalog:",
    JSON.stringify(response.structuredContent ?? response.content, null, 2),
  );
  console.log("Free discovery check complete. No payment was made.");
} finally {
  await client.close();
}
