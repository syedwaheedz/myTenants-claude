-- Full sync schema (plan §4/b5). Extends the 0001 connectivity smoke
-- test to all 9 IndexedDB stores, and replaces that migration's
-- temporary permissive policy on `properties` with real Row Level
-- Security scoped through a memberships table.
--
-- "org" = the shared dataset a signed-in user's data lives under. The
-- app (index.html's ensureMembership()) seeds a self-membership row
-- (user_id = org_id = the signing-in user's own uid) on first sign-in,
-- so today every org has exactly one member — a personal workspace.
-- Adding more members later (a real partner-invite flow) is just more
-- rows in this table; nothing about the schema or policies changes.

create table if not exists public.memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

alter table public.memberships enable row level security;

create policy "memberships_select_own" on public.memberships
  for select
  using (user_id = auth.uid());

-- A user may only ever create a membership for themselves, and only in
-- an org matching their own uid (today's "org_id = own uid" model) —
-- so nobody can add themselves to an arbitrary org_id by guessing it.
create policy "memberships_insert_own_org" on public.memberships
  for insert
  with check (user_id = auth.uid() and org_id = auth.uid());

create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.memberships
    where user_id = auth.uid() and org_id = check_org_id
  );
$$;

-- Drop the 0001 smoke-test policy — real membership-scoped RLS replaces it.
drop policy if exists "smoke_test_anon_all" on public.properties;

do $$
declare
  store text;
  stores text[] := array[
    'properties','tenants','partners','receivers','transactions',
    'transaction_splits','partner_settlements','partner_transfers','audit_log'
  ];
begin
  foreach store in array stores loop
    execute format(
      'create table if not exists public.%I (
         id uuid primary key,
         org_id uuid not null,
         data jsonb not null,
         updated_at timestamptz not null default now(),
         deleted boolean not null default false
       )', store);
    execute format('alter table public.%I enable row level security', store);
    execute format('drop policy if exists "org_members_all" on public.%I', store);
    execute format(
      'create policy "org_members_all" on public.%I
         for all
         using (public.is_org_member(org_id))
         with check (public.is_org_member(org_id))', store);
    execute format('create index if not exists %I on public.%I (org_id, updated_at)',
      store || '_org_updated_idx', store);
  end loop;
end $$;
