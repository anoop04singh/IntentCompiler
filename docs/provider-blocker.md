# Hosted PostgreSQL initialization blocker

Observed 2026-09-12 on StreamingFast deployment `deplevu3d196f80e48cf934`.

The provider accepted Deploy and created a runner. GetDeployment confirms Sepolia, db_out emitting DatabaseChanges, PostgreSQL schema `gr_e69d992d88d54191b4d56a2b559d1bef`, SSL require and Supabase session pooler port 5432. The request used the staged secret; no password was sent inline.

Current-container logs end with:

```text
Error: unable to setup sql sinker: error validating the system table:
"public".cursors table is not found. Did you run setup?
```

No sink event or cursor tables exist in Supabase. HostedService/DeployDatabase was called twice with the same stored secret and private schema. Both returned HTTP 500:

```json
{"code":"internal","message":"failed to deploy database"}
```

SetReplica count=0 succeeded. No tables were deleted or moved into public. New commissioning is disabled, and the catalog has no ready services. The settled 1 test-HBAR commission and HCS receipt remain valid.

The official [DatabaseChanges DSN parser](https://github.com/streamingfast/substreams-sink-sql/blob/develop/db_changes/db/dsn.go) selects schemaName and otherwise defaults to public. This suggests a possible mismatch in the hosted DSN construction; provider internals are unavailable, so the exact cause is unconfirmed. Its [setup implementation](https://github.com/streamingfast/substreams-sink-sql/blob/develop/db_changes/sinker/setup.go) initializes cursor tables and the package schema. That initialization did not complete here.

Provider resolution needed: ensure the hosted DatabaseChanges runner applies the configured private schema and initializes system/event tables there. This report contains no credentials and can be shared with StreamingFast support. It has not been sent externally.

After repair, resume the SAME deployment with one replica, then run:

```sh
npm run deployment:resume -- dd1d0c1b-5585-4091-9351-4486a8714a53
```

Do not use --retry-unsubmitted: this deployment was submitted. Do not buy another commission. Verify provider health, progress and flushed rows before enabling commissioning. Run the existing buyer client with BUYER_MAX_PAYMENT=100000 for the query; the equivalent definition reuses the existing pipeline.

Hosted From-proto is another possible route for insert-only events. It changes the output module, schema generation and reorg behavior, and requires implementation, tests and a fresh stdout review before deployment. It is not currently implemented or verified.
