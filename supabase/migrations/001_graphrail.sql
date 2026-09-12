-- Backend-only schema. Neither anon nor authenticated can read keys, plans, or endpoints.
create schema if not exists graphrail;
revoke all on schema graphrail from public, anon, authenticated;
create table graphrail.pipelines (
 id uuid primary key, fingerprint text not null unique, description text not null,
 definition jsonb not null, entity_schema text not null, price text not null,
 state text not null check (state in ('awaiting_payment','queued','building','testing','deploying','indexing','ready','failed')),
 created_by text, deployment_id text, package_hash text, package_url text, deployment_checked_at timestamptz, indexed_block bigint, error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table graphrail.plans (
 id uuid primary key, pipeline_id uuid not null references graphrail.pipelines,
 commission_amount text not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table graphrail.slots (
 id uuid primary key, deployment_id text unique not null, network text not null,
 db_schema text unique not null, postgres_config jsonb not null, secret_ready boolean not null default false,
 pipeline_id uuid unique references graphrail.pipelines,
 reserved_until timestamptz
);
create table graphrail.payments (
 id uuid primary key, transaction_key text not null unique, request_hash text not null,
 kind text not null check(kind in ('commission','query')), pipeline_id uuid not null references graphrail.pipelines,
 state text not null check(state in ('verifying','settling','settled','failed','reconciliation_required')),
 payer text, requirements jsonb not null, payload jsonb not null, settlement jsonb,
 response_delivered boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table graphrail.jobs (
 id uuid primary key, pipeline_id uuid not null unique references graphrail.pipelines,
 state text not null default 'queued', lease_owner uuid, lease_until timestamptz,
 attempts integer not null default 0, created_at timestamptz not null default now()
);
create table graphrail.audit (
 id uuid primary key, event_key text unique not null, payload jsonb not null,
 state text not null default 'pending', transaction_id text, sequence_number text,
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index catalog_search on graphrail.pipelines using gin (to_tsvector('english', description));
create index jobs_queue on graphrail.jobs (state, lease_until);
create index audit_queue on graphrail.audit (state, next_attempt_at);
alter table graphrail.pipelines enable row level security;
alter table graphrail.plans enable row level security;
alter table graphrail.slots enable row level security;
alter table graphrail.payments enable row level security;
alter table graphrail.jobs enable row level security;
alter table graphrail.audit enable row level security;
revoke all on all tables in schema graphrail from public, anon, authenticated;
-- Use a server-side direct/session-pooler connection. Do not expose graphrail in the Data API.

create table graphrail.provider_credentials (
 id text primary key, value jsonb not null, expires_at timestamptz not null
);
alter table graphrail.provider_credentials enable row level security;
revoke all on graphrail.provider_credentials from public, anon, authenticated;
