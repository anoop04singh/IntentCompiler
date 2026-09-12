# GraphRail

**Agent marketplace: services register, agents discover and pay.** An existing MCP agent turns a natural-language intent into a typed EVM event definition. GraphRail finds reusable services, quotes a build, accepts Hedera testnet payments through x402/Blocky, builds Substreams, and commissions a StreamingFast hosted SQL sink into Supabase. Other agents discover the service and pay for queries.

There is **no Anthropic key, hosted model, or MCP sampling requirement**. This is a remote Streamable HTTP MCP server at `/mcp`. One user prompt drives several agent tool calls; the server itself does not infer contract ABIs from prose. Paid tools require an x402-capable MCP client or wallet helper.

This checkout is configured for testnet acceptance. Supabase setup, live Sepolia output review, Market authentication, password staging, and a real x402 commissioning settlement have been verified. See [verification.md](docs/verification.md) for the current deployment and query results.

## Deployment choice

Graph Node v0.42 removed Substreams-powered subgraphs ([release notes](https://github.com/graphprotocol/graph-node/blob/master/NEWS.md#v0420)). This implementation follows the selected replacement: **Substreams → DatabaseChanges → StreamingFast hosted PostgreSQL sink → Supabase**. Your Studio deploy key is not needed.

StreamingFast runs the sink; Supabase stores both the marketplace catalog and indexed event data. Each pipeline has a private `gr_<uuid>` schema. GraphRail translates bounded GraphQL reads to parameterized SQL. SQL credentials, provider tokens, deployment IDs and private configuration are excluded from public catalog responses. Compiled packages are public; blockchain data and compiler logic are not exclusive intellectual property.

## Implemented flow

| Stage | Behavior |
| --- | --- |
| Intent and reuse | Free keyword search; agent checks coverage; canonical definitions deduplicate equivalent pipelines |
| Quote | Persistent 30-minute plan, exact ABI/schema, separate commission and query prices |
| Commission | Official x402 MCP metadata and Hedera exact scheme; reserve a prepared hosted slot before settlement |
| Build | Deterministic Rust/Abigen templates, typed event protobufs, block filter, `db_out`, PostgreSQL DDL |
| Verification | Native decoder tests, WASM build, `.spkg` packing, live JSONL output validation for every event |
| Deployment | SHA-256-addressed package in Supabase Storage; hosted SQL deployment using a staged password |
| Registration | Provider health and progress plus actual flushed rows determine readiness; HCS provenance outbox |
| Queries | Free discovery, paid bounded GraphQL-to-SQL reads, settlement and eventual HCS receipt |

The compiler currently accepts **Ethereum Sepolia only**. Configuration rejects mainnet pipelines, non-testnet Hedera payments, and a non-testnet Blocky facilitator. Hosted capacity must be prepared for Sepolia. It preserves uint256/int256 values as decimal strings and `NUMERIC(78,0)`. Addresses/bytes use hex text. Arrays, tuples, anonymous/overloaded events, indexed dynamic fields, custom stores, aggregates and RPC enrichment require compiler extensions and are rejected before payment. This is not unrestricted natural-language program generation.

## Configure

1. Install Node 22 and run `npm ci`. Copy `.env.example` to `.env` and fill it locally.
2. Set `DATABASE_URL` to the Supabase **direct or session-pooler connection, port 5432**, with a URL-encoded password. Session advisory locks cannot use transaction pooler port 6543. Keep TLS enabled. Set `SUPABASE_URL` and the server-only `SUPABASE_SERVICE_ROLE_KEY`.
3. Run `npm run db:migrate`. This creates the private `graphrail` schema, RLS, jobs, payments, catalog and credentials tables. Do not expose `graphrail` or `gr_*` through the Data API. Use the privileged database connection only on the backend.
4. Run `npm run setup:storage` to create the dedicated public package bucket. It contains only `.spkg` files; credentials and logs must never go there.
5. Create and fund an account in the [Hedera testnet portal](https://portal.hedera.com/). Fill `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`, and `HEDERA_PAY_TO`. Run `npm run setup:hedera` once and put the returned topic ID into `HEDERA_HCS_TOPIC_ID`. This uses test HBAR. An existing configured topic is reused.
6. Keep the default Blocky testnet facilitator URL. Its sponsored fee payer is discovered from `/supported`. `PAYMENT_ASSET=0.0.0` means HBAR; the defaults are **1 test HBAR per commission** and **0.001 test HBAR per query**. The amounts are tinybar, not dollars.
7. Obtain a Substreams data-plane API key from [The Graph Market](https://thegraph.market/) and set `SUBSTREAMS_API_KEY`. It is separate from Market login credentials.

### First hosted-sink setup

Before first live hosting, use the bundled hosted-sink skill's output-review step: inspect a short **`substreams run` stdout sample** and confirm its data quality, or explicitly choose to skip that review. Compiling alone does not verify on-chain coverage. The included Sepolia USDC sample was reviewed and approved: 205 Transfer events across 100 blocks. It does not require writing event data to a local database.

The example can be prepared without credentials:

```sh
npm run example:generate
cd builds/example-usdc
cargo test
cargo build --release --target wasm32-unknown-unknown
substreams pack substreams.yaml -o pipeline.spkg
substreams run pipeline.spkg db_out --network sepolia -e sepolia.eth.streamingfast.io:443 -s 11686714 -t +100 -o jsonl
```

After the output review, prepare hosted capacity from the repository root:

```sh
npm run setup:market -- start
# Approve the displayed login in your browser, then:
npm run setup:market -- finish
npm run setup:slot -- create
# Save the DB password on the printed The Graph Market secret page, then:
npm run setup:slot -- confirm-secret SLOT_UUID
```

Populate `SINK_DB_HOST`, `SINK_DB_PORT`, `SINK_DB_USER`, `SINK_DB_NAME`, and `SINK_NETWORK` first. Use the same Supabase host, database and privileged user as `DATABASE_URL`. No password is sent to the hosted Deploy endpoint: the server uses `use_stored_secret:true`. Market access/refresh tokens remain in the private database; login approval and secret confirmation are explicit commands, with no background polling.

One prepared slot supports one pipeline. Repeat slot creation and password staging to increase capacity. StreamingFast may impose account limits and bills the operator for hosted compute; the configured HBAR fee does not automatically track that bill. Slot creation only prepares metadata; the paid commission submits the actual deployment.

Run `npm run setup:check` in the worker environment, then set `COMMISSIONING_ENABLED=true` when ready to accept paid builds. This flag is a commissioning kill switch. The setup check is a preflight, not proof of successful deployment.

## Run and connect

The supplied Docker worker uses Linux amd64 with Rust, `wasm32-unknown-unknown`, protoc, buf, and Substreams CLI. Docker and CI pin the CLI to v1.22.0. A Windows worker has also been exercised with explicit SUBSTREAMS_BIN, PROTOC and CARGO_HOME paths. Graph CLI is not required.

```sh
docker compose build
docker compose up -d
```

Or with the toolchain already installed:

```sh
npm run build
npm start
# In another process:
npm run worker:start
```

Expose port 3000 through your hosting platform's HTTPS reverse proxy. Set `PUBLIC_URL`, `ALLOWED_ORIGINS`, and preserve the Host header. Compose binds the API to loopback; the worker is private. Mount persistent build storage. The repository does not provision a public domain or hosting account. For cloudflared or another trusted proxy on this machine, set TRUST_LOOPBACK_PROXY=true; leave it false otherwise. Configure your actual proxy topology and a shared rate limiter when scaling.

The current temporary test endpoint is `https://spatial-afterwards-shaved-scope.trycloudflare.com/mcp`. It requires this machine, the API and cloudflared to stay running; it is not durable hosting. Connect a compatible MCP agent using Streamable HTTP, read `graphrail://skills/workflow`, or invoke the `build_pipeline` prompt. The server bundles Substreams development, Ethereum, SQL, testing and hosted-sink skills plus reference resources.

| Tool | Price | Result |
| --- | --- | --- |
| `create_pipeline(prompt, definition?)` | Free | Candidate services, a quote, or an exact coverage match |
| `commission_pipeline(planId, requestId)` | Commission fee | Durable job ID and payment receipt |
| `get_pipeline_status(pipelineId)` | Free | Build/indexing state, indexed block, failure code |
| `list_pipelines(keyword?)` | Free | Ready services, coverage, schema and price |
| `query_pipeline(pipelineId, query, variables?, requestId)` | Query fee | Live SQL-backed data and settlement |
| `get_payment_receipt(paymentId)` | Free | Settlement and eventual HCS receipt |
| `search_substreams_packages(keyword)` | Free | Official registry suggestions for planning |

`examples/usdc.ts` contains a complete definition. `examples/agent.ts` demonstrates the official x402 MCP client with local Hedera signing and a cumulative spending ceiling. It explicitly allows testnet HBAR in x402 spendControls, checks the recipient, and caps total spending. Run npm run setup:buyer once to create/fund a separate test buyer. It does not implement an LLM; your agent supplies the reasoning. A generic MCP connection alone cannot sign payments. Wallet private keys never belong in tool arguments. x402 challenges use structured MCP results and payment metadata, rather than disrupting the transport with a raw HTTP 402.

### Query format

Each catalog entity exposes a lower-camel singular root with `id`, and a plural root with `first` (default 25, maximum 100), `skip` (maximum 5000) and `where`. Filters support equality on all entity fields plus `blockNumber_gte` and `blockNumber_lte`. Results sort by block number and ID. There are no arbitrary SQL, mutations, joins, aggregates, fragments or introspection operations.

```graphql
{ transfers(first: 10, where: {blockNumber_gte: "11686714"}) {
  id blockNumber transactionHash contract arg_from arg_to arg_value
} }
```

Big integers are exact decimal strings. A call permits at most five entity roots, 60 fields, a 15-second SQL timeout and a 2 MB serialized result. Each purchase uses a fresh UUID `requestId`.

## Reliability and limits

- Commission settlement, the receipt and job creation are persisted atomically. The API returns without waiting for the Rust build. Workers use renewable leases; exact definitions share one pipeline.
- Hedera transaction identity is the replay key. Retries of a settled commission return its existing job. Another request cannot reuse that transaction. Settlement timeouts remain in reconciliation until Mirror Node proves success or failure; absence is not failure.
- Query validation/signature verification and the database read happen before settlement. Failed reads are not charged; results are released only after settlement. Query responses are not cached. A network loss after the result is marked delivered requires operator handling or another purchase; replay is refused.
- Hosted deployment intent is stored before the provider call. An ambiguous submission is polled against the same deployment ID, never blindly resubmitted. A provider error needs operator reconciliation. Paid builds that fail before deployment can be retried with `npm run job:retry -- PIPELINE_UUID`; a prepared/submitted deployment requires `npm run deployment:resume -- PIPELINE_UUID`. If no runner exists, inspect The Graph Market and use the script's explicit retry option only after confirming submission did not occur.
- `ready` means healthy and indexed beyond the tested range with rows flushed to Supabase, not necessarily caught up to the chain head. Health is refreshed every 30 seconds. Hosted PostgreSQL cursor/reorg handling owns undo and replay; GraphRail does not invent a high-water-mark store.
- HCS receipts are eventual, at-least-once audit messages with stable IDs for deduplication. HCS outages do not block builds. The implementation uses the Hedera/Hiero SDK directly.
- Fees go to the configured seller `HEDERA_PAY_TO`. Creator revenue splitting and automatic refunds are not implemented. Failed paid builds retain receipts and need operator repair/refund review.
- ABI source URLs are provenance, not proof. The connected agent must verify the ABI and contract relationship. The worker executes trusted templates, never caller-supplied Rust, shell commands, paths or fetched ABI URLs.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run example:generate
```

Tests use the real migration in embedded PostgreSQL (PGlite), simulated advisory locks, mocked provider settlement/deployment, an actual remote MCP connection, and generated Rust decoder fixtures. See [acceptance.md](docs/acceptance.md) for live checks and [sources.md](docs/sources.md) for official references. Passing local tests is not evidence of live ledger settlement or hosted indexing.

On Windows, start the worker with `scripts\start-worker-windows.cmd` after `npm run build`; it initializes the installed Visual Studio C++ toolchain before starting Node.

**Current live blocker:** StreamingFast database initialization failed; the runner is paused and COMMISSIONING_ENABLED=false. See [provider-blocker.md](docs/provider-blocker.md). No service is advertised and no query fee has been charged.


## Landing page and agent quickstart

The landing page is served by the same API at `/`. Run `npm run build` and `npm start`, then open http://localhost:3000/. The frontend lives in `public/`, requires no separate build, and is included in the API Docker image.

Live statistics come from `/api/public/stats`: ready services, settled commissions, settled query purchases, payment volume and recorded HCS receipts. The server caches the explicit public projection for 15 seconds; the page refreshes every 30 seconds and labels stale data on failure. No database credentials, payment payloads or failed-intent descriptions are exposed.

The connection panel generates Codex, Claude Code and Cursor snippets from the running `PUBLIC_URL`. Use the downloadable [agent setup guide](public/setup.md) for connection steps, free prompts, buyer setup, and self-hosting. Run `npm run example:discover` for a free SDK connection test. Paid calls need an x402 client or wallet helper; an ordinary MCP configuration alone cannot sign payments.

Design follows the provided Optimus reference: Instrument Serif / Instrument Sans typography, warm off-white surfaces, fine grids and an animated ASCII sphere. Reduced-motion settings are respected. The live status accurately reflects the existing hosted-indexing blocker.
