-- Restrict who can create an account at all. Without this, anyone who
-- discovers the app's URL can enter any email and sign themselves up
-- (each new signup gets its own isolated workspace, so this isn't a data
-- leak into your workspace — but it does mean the app is open to literally
-- anyone, which isn't the intent for a private tool). Enforced server-side
-- via Supabase's before_user_created Auth Hook, not a client-side check —
-- a client-side email check would be trivially bypassed by anyone calling
-- the Supabase API directly.

create table if not exists public.allowed_emails (
  email text primary key,
  added_at timestamptz not null default now(),
  note text
);

-- No RLS policies granted — this table is intentionally unreadable/
-- unwritable from the client (anon or authenticated). Only the hook
-- function below reads it, running as supabase_auth_admin.
alter table public.allowed_emails enable row level security;

insert into public.allowed_emails (email, note)
values ('syedwaheedz@gmail.com', 'app owner')
on conflict (email) do nothing;

create or replace function public.hook_restrict_signup_to_allowlist(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_email text;
begin
  user_email := lower(event->'user'->>'email');
  if user_email is not null and exists (
    select 1 from public.allowed_emails where lower(email) = user_email
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This app is invite-only. Contact the admin to be added.'
    )
  );
end;
$$;

grant execute on function public.hook_restrict_signup_to_allowlist to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_to_allowlist from authenticated, anon, public;
