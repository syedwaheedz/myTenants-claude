-- Lets an app admin manage the sign-in allowlist from inside the app,
-- instead of needing a direct database query every time. "admin" is a
-- flag on allowed_emails itself (not a hardcoded email) so it can be
-- handed to more than one person later just by flipping the flag.

alter table public.allowed_emails add column if not exists is_admin boolean not null default false;

update public.allowed_emails set is_admin = true where email = 'syedwaheedz@gmail.com';

create or replace function public.is_admin_email()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.allowed_emails
    where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
      and is_admin = true
  );
$$;

-- allowed_emails already has RLS enabled with zero policies (migration
-- 0003) — add exactly the three an admin needs, still nothing for anyone
-- else.
create policy "admins_select_allowed_emails" on public.allowed_emails
  for select using (public.is_admin_email());
create policy "admins_insert_allowed_emails" on public.allowed_emails
  for insert with check (public.is_admin_email());
create policy "admins_delete_allowed_emails" on public.allowed_emails
  for delete using (public.is_admin_email());
