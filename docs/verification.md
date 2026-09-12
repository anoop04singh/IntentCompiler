# Live verification — 2026-09-12

**Not yet a working indexed service:** hosted database initialization failed. The runner is paused, new commissioning is disabled, and no paid query was attempted. See [provider-blocker.md](provider-blocker.md) and [live-evidence.json](live-evidence.json).

| Check | Observed result |
| --- | --- |
| TypeScript build | Passed |
| Automated tests | 33 passed across 7 files, including reserved-connection rollback and mainnet configuration rejection |
| Supabase | Private catalog migration installed; credentials verified; package bucket created |
| Generated Rust | Native decoder tests and WASM release build passed |
| Live Substreams output | 205 Sepolia USDC Transfer events in blocks 11,686,714–11,686,813; user reviewed and approved |
| Package publication | Public package downloaded and SHA-256 verified |
| Market | Login, deployment ID, saved-password existence and hosted Deploy succeeded |
| Hosted indexing | Runner failed looking for public.cursors despite private-schema config; database attachment returned HTTP 500 twice; runner paused |
| Public HTTPS MCP | Seven tools, 21 resources, readable workflow; no ready services listed |
| x402 / Blocky | Commission settled for 100,000,000 tinybar (1 test HBAR); Mirror Node confirms SUCCESS and seller credit |
| HCS | Commission audit confirmed at topic 0.0.10496618, sequence 1 |
| Paid query | Not run: no indexed data and service not ready |

Pipeline: `dd1d0c1b-5585-4091-9351-4486a8714a53`.
Commission receipt: `2b44ea1c-ee74-4fbd-a385-cc1b478083da`.
Ledger transaction: `0.0.7162784@1789222750.261013888`.
Package SHA-256: `e528f58e6a3a639d7f065ba551e61500b532fb67fb1d632ff4f9a18851cc37f4`.

Temporary MCP endpoint: `https://diamonds-releases-modification-sponsored.trycloudflare.com/mcp`. This requires the local machine, API and cloudflared process to remain running. It is not durable hosting. Quick Tunnels do not support SSE; GraphRail uses stateless Streamable HTTP with JSON responses.

The initial buyer attempt stopped before settlement because a reserved PostgreSQL connection lacked begin(). Its record was closed after checking the failure location, absence of a job/slot, and Mirror Node 404. The later commission is the only settled payment. Windows compiler startup was repaired and the same paid job retried without another fee.

Docker execution, live reorg recovery, provider failure injection, completed hosted indexing and query settlement remain unverified. Mocked tests are not evidence of those outcomes.
