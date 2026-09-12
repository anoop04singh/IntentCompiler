# Local verification — 2026-09-11

| Check | Observed result |
| --- | --- |
| TypeScript build/type checking | Passed |
| Automated tests | 27 passed across 5 files |
| Generated USDC Rust native tests | 2 passed: empty block and independently encoded ABI decoding with full-width integer/reverted-call checks |
| Generated WASM release build | Passed; 376,917 bytes |
| Official Substreams v1.22.0 pack | Passed; 516,826-byte `.spkg` |
| Official package inspection | db_out emits DatabaseChanges; PostgreSQL Service config embeds 362-byte schema.sql |
| Remote MCP protocol | Exercised through an actual local HTTP client/server connection |
| Database lifecycle | Real migration and SQL queries in PGlite; provider calls mocked |
| Payment behavior | Mocked verification/settlement ordering, replay rejection, durable enqueue and ambiguous-payment handling |
| Hosted lifecycle | Mocked provider; failed output blocked, uncertain submission not repeated, catalog waits for flushed rows |

Example: `builds/example-usdc/pipeline.spkg`

SHA-256: `d2ecdb381b24981465aac88b44857b758d3c8524987949e219c6d5970ec5a84a`

The Windows Substreams CLI was built from official v1.22.0 source for local packing. Deployment/CI target the supplied Linux worker image. Docker image execution was not verified because no running Docker daemon was available.

Not performed: Supabase production migration, live Substreams output review, Market login/secret staging/Deploy, Hedera settlement or HCS submission, public HTTPS hosting, and live reorg acceptance. These require operator configuration. See acceptance.md before claiming a live marketplace deployment.
