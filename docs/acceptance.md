# Live acceptance after configuration

See verification.md for observed live results. The checklist below also includes failure/reorg scenarios beyond the initial smoke test. Use Sepolia data and Hedera testnet payments. StreamingFast hosted compute can still be billable.

1. Configure `.env`, install the private migration and package bucket, and fund/configure Hedera testnet and HCS. Review the stdout-only example `substreams run` sample before first hosting, following the bundled hosted-sink skill. Verify the actual decoded amounts, addresses, selected events and range.
2. Complete Market browser login and prepare a fresh Sepolia hosted slot. Save the password on its secret page and confirm once. Run `setup:check` inside the worker environment. Enable commissioning and expose the API through HTTPS.
3. Connect a payment-enabled agent with a spending ceiling covering both fees. A free intent/definition call must show coverage, both prices, capacity and an expiring plan, with no job or ledger transaction.
4. Commission without payment: expect the structured x402 challenge containing the network, recipient, asset, amount and discovered Blocky fee payer. Sign locally and retry; record paymentId, jobId, pipelineId and settlement transaction.
5. Retry the same signed request: expect the same job and no second settlement. Reuse its payment with a different request: expect rejection.
6. Observe queued, building, testing, deploying and indexing. Inspect private verification.json. The packaged db_out module must emit DatabaseChanges for every selected event. Confirm the public package bytes match the recorded SHA-256.
7. Verify the Market deployment uses that package, db_out, the selected network, stored secret and correct private Supabase schema. Check provider health/progress and actual rows before catalog registration. Compare exact integer values to source logs. Exercise reorg undo/replay in a controlled provider fixture before promising production finality guarantees.
8. A second agent discovers and pays only for a query. Confirm the returned data, settlement, eventual HCS sequence and Mirror Node ledger receipt. Check that anonymous Supabase roles cannot read catalog secrets or indexed event schemas.
9. A paraphrased intent with equivalent definition must reuse the pipeline; changing contract/event/start block must produce a new quote.
10. Exercise controlled failures: empty output, failed SQL read, Blocky timeout, worker restart, hosted Deploy timeout, provider outage and HCS outage. No service should be advertised before readiness. An ambiguous payment or deployment must not be retried with new money/new infrastructure automatically.

Keep unresolved settlement/deployment cases for operator reconciliation. Record real transaction IDs, deployment health, package hashes and query evidence here when live acceptance is actually performed.
