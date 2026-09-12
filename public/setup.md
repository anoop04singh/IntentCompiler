# GraphRail: connect your agent and try it

GraphRail is a remote Streamable HTTP MCP server. You do not need an Anthropic key, Supabase credentials or a GraphRail account to use its free tools. Your own agent supplies the reasoning. Paid tools additionally need an x402 client or a locally signing wallet helper.

## 1. Choose the server URL

Open the landing page and copy the current Server URL from the connection panel. It is generated from the running server's PUBLIC_URL, so it stays correct when your deployment domain changes.

For an agent running on the SAME machine, you can use:

http://localhost:3000/mcp

For a remote agent, use the HTTPS URL from the page. localhost on another machine will not reach GraphRail. The current Cloudflare Quick Tunnel is temporary and requires the operator's machine and processes to stay running. A changed tunnel URL must also be updated in your agent configuration.

The browser homepage is `/`; the MCP protocol endpoint is `/mcp`. Visiting /mcp in a browser can return HTTP 405 because it accepts protocol POST requests. This is expected.

## 2. Connect an agent

Replace YOUR_MCP_URL below with the actual endpoint. Merge entries into existing config files instead of overwriting your other servers.

### Codex

Add to ~/.codex/config.toml (Windows: %USERPROFILE%\.codex\config.toml):

```toml
[mcp_servers.graphrail]
url = "YOUR_MCP_URL"
```

Start a new session after saving. In the Codex app you can also add a remote MCP server from its MCP settings. Verify that GraphRail tools appear before sending your prompt.

Official instructions: https://developers.openai.com/codex/mcp/

### Claude Code

Run in your project directory:

```sh
claude mcp add --transport http graphrail "YOUR_MCP_URL"
```

Run `/mcp` inside Claude Code to inspect the connection. Free GraphRail calls require no login or Authorization header.

Official instructions: https://code.claude.com/docs/en/mcp

### Cursor

Merge into .cursor/mcp.json in your project (or ~/.cursor/mcp.json globally):

```json
{
  "mcpServers": {
    "graphrail": {
      "url": "YOUR_MCP_URL"
    }
  }
}
```

Enable GraphRail in Cursor's MCP settings, and start or reconnect the agent.

Official instructions: https://cursor.com/docs/mcp

### Other agents

Select a remote Streamable HTTP MCP server, name it GraphRail, and enter the URL. The exact configuration structure depends on your client. Do not configure this server as a local stdio process or as SSE-only.

## 3. Try a free prompt

Paste this into your agent:

> Use GraphRail. Read graphrail://skills/workflow, then call list_pipelines. Tell me which Ethereum Sepolia services are ready, their coverage, and their query prices. Keep this test free; do not commission or purchase a query.

Expected: your agent reads the workflow resource and calls list_pipelines. An empty list is a valid result while the hosted deployment is paused. You should still see these seven tools:

- create_pipeline
- list_pipelines
- commission_pipeline
- get_pipeline_status
- query_pipeline
- get_payment_receipt
- search_substreams_packages

For a free terminal check from this checkout, run `npm run example:discover`. It lists tools, reads the workflow and calls discovery without signing or making any payment.

Try planning next:

> Use GraphRail to plan a pipeline for USDC Transfer events on Ethereum Sepolia. Check for reuse first. Read the Substreams skills, verify the contract and ABI from official sources, and show me the exact coverage, schema, commissioning fee and per-query fee. Keep this step free; do not commission it.

A prompt-only create_pipeline call returns planning instructions and candidates. Your agent needs to supply a verified structured definition for a quote. The server does not autonomously infer ABI definitions from prose.

## 4. Try payments after the hosted service is repaired

Current status at 2026-09-12: the example's build and stdout checks passed, and 1 test HBAR was settled via Blocky with HCS confirmation. The hosted sink failed during database initialization. Its runner is paused, no pipeline is ready, and commissioning is disabled. Do not pay again for that build. Check the landing page's live status before attempting a new purchase.

A generic MCP connection cannot sign Hedera transactions on its own. The repository includes examples/agent.ts, which uses @x402/mcp and @x402/hedera to sign locally, restrict payments to Hedera testnet and the configured seller, allow HBAR explicitly, and enforce a cumulative budget.

For a coding agent with access to this checkout and a terminal:

1. Keep BUYER_ACCOUNT_ID and BUYER_PRIVATE_KEY in the local .env file. Never paste private keys into chat or MCP arguments. Use only a funded testnet buyer account. `npm run setup:buyer` creates a separate buyer funded with 2 test HBAR from the configured test operator; skip it if a buyer already exists.
2. Set PUBLIC_URL to the chosen server origin, and HEDERA_PAY_TO to its expected seller. The buyer validates this recipient.
3. Set BUYER_MAX_PAYMENT in tinybar: 100100000 allows a 1 test-HBAR commission plus a 0.001 test-HBAR query. For the already commissioned example, set 100000 to allow only one query.
4. After the operator repairs hosted indexing and the pipeline is ready, run `npm run example:agent`. Equivalent definitions reuse the existing paid pipeline, and only a new query is purchased.
5. Record the paymentId and call get_payment_receipt for settlement and eventual HCS details.

The script is an example buyer, not a transparent payment adapter for every agent. To use another agent runtime programmatically, wrap its MCP calls with createx402MCPClient as demonstrated in examples/agent.ts. Keep network, asset, recipient and spending checks in that client. An ambiguous payment must be reconciled before a new signature/payment is generated.

Example ready-service query:

```graphql
{ transfers(first: 5) { id blockNumber arg_from arg_to arg_value } }
```

query_pipeline also requires pipelineId, variables (usually {}) and a fresh UUID requestId. Big integers are exact decimal strings. A delivered query payment cannot be replayed.

## 5. Run this checkout

If this installation is already configured, do not rerun its one-time migration, create another buyer, or reset the existing deployment. Keep COMMISSIONING_ENABLED=false until the provider issue is repaired.

```sh
npm ci
npm run setup:check
npm run build
npm start
```

The landing page is http://localhost:3000/. The MCP URL is http://localhost:3000/mcp. There is no separate frontend build or Node service: public/ is served by Express, and /api/public/stats provides a cached, explicit public projection of Supabase aggregates. Database credentials remain server-side. Fonts come from Google Fonts with local fallbacks.

Start the worker in another terminal:

```sh
npm run worker:start
```

On Windows with Visual Studio C++ Build Tools, use:

```bat
scripts\start-worker-windows.cmd
```

This initializes the native compiler before Node starts. Rust, the wasm32-unknown-unknown target, protoc and Substreams v1.22.0 are required. Set SUBSTREAMS_BIN, PROTOC and CARGO_HOME to your installed paths where needed.

### Fresh installations only

1. Install Node 22 and run npm ci. Copy .env.example to .env.
2. Configure Supabase DATABASE_URL using the direct or session pooler port 5432 with a URL-encoded password, DATABASE_SSL=true, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
3. Run npm run db:migrate ONCE, then npm run setup:storage.
4. Configure a funded Hedera testnet operator and seller. Run npm run setup:hedera. Use BLOCKY_FACILITATOR_URL=https://api.testnet.blocky402.com and HEDERA_NETWORK=hedera:testnet.
5. Set SUBSTREAMS_API_KEY and the explicit Sepolia endpoint. Review a short stdout-only Substreams sample before the first hosted deployment.
6. Run npm run setup:market -- start, approve the browser login, then npm run setup:market -- finish.
7. Set the SINK_DB_* fields and SINK_NETWORK=sepolia. Run npm run setup:slot -- create. Save the password at the returned Market secret page, then run npm run setup:slot -- confirm-secret SLOT_UUID.
8. Run npm run setup:check. Start the API and worker. Enable commissioning only after hosted capacity and database initialization have passed acceptance. StreamingFast compute may be billable even though chain data/payments use testnets.

### Public access

Put an HTTPS reverse proxy in front of port 3000 and set PUBLIC_URL to its origin. Set ALLOWED_ORIGINS to trusted browser origins. For a trusted proxy on this same machine, set TRUST_LOOPBACK_PROXY=true; leave it false otherwise. Preserve the Host header.

For temporary testing, an installed cloudflared can run:

```sh
cloudflared tunnel --url http://127.0.0.1:3000
```

Copy the returned origin into PUBLIC_URL and ALLOWED_ORIGINS, enable TRUST_LOOPBACK_PROXY, and restart the API. Quick Tunnels change URLs and have no uptime guarantee. Use a stable domain and persistent hosting for a durable service.

Docker users: docker compose build && docker compose up -d. The image includes the public/ landing page. Docker execution remains unverified in this workspace because no running daemon was available.

## Troubleshooting

- No tools: confirm the /mcp suffix, Streamable HTTP transport, current tunnel URL and running API. Reconnect the agent.
- HTTP 403: inspect PUBLIC_URL host and ALLOWED_ORIGINS. Allow your trusted client origin explicitly.
- Empty catalog: only ready pipelines are advertised. Check live status; do not treat a failed build as a ready service.
- Payment challenge: use an x402-capable client or wallet helper; a normal remote MCP setup alone cannot pay.
- Live stats unavailable: check API/Supabase connectivity. The page preserves stale values with an explicit offline label instead of inventing zeros.
- Current hosted failure: see docs/provider-blocker.md in the checkout. Resume the existing deployment after repair; do not commission a duplicate.
