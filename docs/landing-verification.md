# Landing page verification

Verified 2026-09-12 against the running testnet service.

- TypeScript build passed; 35 tests passed across 8 files.
- Real Supabase counters: 0 ready pipelines, 1 settled commission, 0 paid queries, 1 test HBAR settled; commissioning disabled.
- Public HTTPS homepage, configuration and statistics routes returned HTTP 200.
- Desktop (1440 px) and mobile (390 px) rendered with no horizontal overflow or page JavaScript errors.
- Agent tabs, keyboard tab selection, mobile navigation, catalog search and expandable setup instructions exercised.
- Clipboard output matched the displayed configuration after normalizing Windows CRLF line endings; starter prompt copied correctly.
- Simulated statistics outage retained prior figures and displayed an offline label. A failed initial load displayed dashes rather than zero values.
- Separate official MCP SDK client connected over the public HTTPS URL, listed all seven tools, read the workflow and called list_pipelines. No payment was made.

Temporary landing page: https://spatial-afterwards-shaved-scope.trycloudflare.com/
MCP: https://spatial-afterwards-shaved-scope.trycloudflare.com/mcp

The tunnel requires the local machine and processes to remain available. The landing-page work does not resolve the existing hosted sink initialization blocker. No indexing readiness or successful paid query is claimed.

Official connection references are linked in the page and public/setup.md. The provided Optimus source design informed the typography, neutral palette, grid and ASCII animation.
