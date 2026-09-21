-- Connectivity smoke test table (see plan §0). Mirrors the IndexedDB
-- "properties" store as a jsonb payload so no client-side reshaping is
-- needed once the real sync layer lands, rather than hand-typing columns
-- for a schema that may still change.
create table if not exists public.properties (
  id uuid primary key,
  org_id uuid not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

alter table public.properties enable row level security;

-- TEMPORARY: permissive policy for the connectivity smoke test only.
-- No org/membership system or auth UI exists yet (that's plan §4), and
-- this project's anon key isn't embedded in any shipped build yet, so
-- this is a safe interim state — but it MUST be replaced with a real
-- memberships-scoped policy before any client ever ships pointing at
-- this project. Tracked in plan §4.
create policy "smoke_test_anon_all" on public.properties
  for all
  using (true)
  with check (true);
