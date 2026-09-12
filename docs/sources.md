# Official integration references

Reviewed for this implementation on 2026-09-11. The installed SDK declarations and official Rust DatabaseChanges crate were also inspected to avoid stale snippets.

**Superseding source:** [Graph Node v0.42 release notes](https://github.com/graphprotocol/graph-node/blob/master/NEWS.md#v0420) explicitly remove Substreams support. This takes precedence over the older Studio/Substreams guides below. GraphRail therefore uses hosted SQL into Supabase.

| Source | Used for |
| --- | --- |
| [x402 MCP package](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mcp) | Payment metadata, client wrapper, payment-required structured tool results, settlement response |
| [x402 Hedera package](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/hedera) | Native Hedera exact scheme, atomic asset amounts, partially signed transaction payload |
| [Blocky402 networks](https://blocky402.com/docs/networks/) | Testnet facilitator URL, supported-network discovery, native HBAR asset and fee payer |
| [Blocky402 API](https://blocky402.com/docs/api-reference/) | `/supported`, `/verify`, `/settle` request/response contract |
| [Hedera SDK topic creation](https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/create-a-topic) | Topic creation and submit key |
| [Hedera Mirror Node REST API](https://docs.hedera.com/hedera/sdks-and-apis/rest-api) | Public transaction reconciliation |
| [Substreams Ethereum SDK](https://github.com/streamingfast/substreams-ethereum) | ABI generation, successful-transaction iteration and typed log decoding |
| [Substreams testing](https://docs.substreams.dev/reference-material/development-tools/testing) | Native handler tests and short live output verification |
| [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) | Private tables and client-role access control |
| [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres) | Direct/session pooling for session-scoped advisory locks |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Stateless Streamable HTTP server and client transport |
| [Hedera ETHOnline track brief](https://ethglobal.com/events/ethonline2026/prizes/hedera) | Marketplace framing: services register, agents discover and pay |

Bundled Substreams skills are StreamingFast-authored Apache-2.0 material. The SQL and hosted-sink skills guide the selected deployment path. The installed `thegraph-market-api` skill documents exact HostedService and device-login protobuf fields; `src/deployment.ts` follows these shapes. The live account-dependent HostedService calls still require acceptance testing with operator credentials.

| Additional official source | Used for |
| --- | --- |
| [Substreams Database Changes](https://docs.substreams.dev/how-to-guides/sinks/sql/db_out) | db_out, typed SQL mapping and schema |
| [SQL sink configuration](https://docs.substreams.dev/reference-material/sql/sql/sink-config) | Manifest Service config and PostgreSQL engine |
| [Database Changes v4](https://github.com/streamingfast/substreams-sink-database-changes/releases/tag/v4.0.0) | Official import package and Rust types |
| [Substreams sinks](https://docs.substreams.dev/how-to-guides/sinks) | Sink architecture and supported destinations |
| [Supabase Storage bucket creation](https://supabase.com/docs/reference/javascript/file-buckets-createbucket) | Dedicated public package bucket |
| [Supabase Storage uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) | Content-addressed package upload and conflict handling |

The output review, hosted billing, browser login and secret staging described in the operator guide follow the installed hosted-sink and Market API skills. No actual login, CreateDeployment or Deploy was executed during implementation without credentials.
