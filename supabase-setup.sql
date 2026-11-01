-- =============================================================================
--  IT BOOSTER — Supabase database setup
--  Run this WHOLE file ONCE in:  Supabase → SQL Editor → New query → paste → Run
--  Safe to run again later (it only creates what is missing / refreshes functions). Your data is kept.
--
--  Security model:
--    • Tables are locked (Row Level Security ON, no public policies, no public grants).
--    • The app talks to the database ONLY through the functions below.
--    • Passwords are stored as bcrypt hashes. Login sessions are random tokens stored as hashes.
--    • 5 wrong passwords lock that User ID for 10 minutes.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists itb_private;
revoke all on schema itb_private from public, anon, authenticated;

-- ------------------------------------------------------------------ tables ---
create table if not exists public.itb_users (
  id           bigint generated always as identity primary key,
  login_id     text not null unique,
  pass_hash    text not null,
  role         text not null default 'user'   check (role in ('user','admin')),
  status       text not null default 'active' check (status in ('active','suspended')),
  town         text, sap text, it_name text, house text, email text, it_phone text, mgr_phone text,
  reg_id       uuid,
  failed       int  not null default 0,
  locked_until timestamptz,
  last_login   timestamptz,
  created_at   timestamptz not null default now()
);

-- access end date (last day of access, Bangladesh time; empty = no limit)
alter table public.itb_users add column if not exists expires_on date;

create table if not exists public.itb_regs (
  id         uuid primary key default gen_random_uuid(),
  town text not null, sap text not null, it_name text not null, house text not null,
  email text not null, it_phone text not null, mgr_phone text not null,
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason     text,
  login_id   text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.itb_sessions (
  token_hash text primary key,
  user_id    bigint not null references public.itb_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.itb_config (
  id int primary key check (id = 1),
  enabled boolean not null default true,
  registration_open boolean not null default true,
  message text not null default '',
  announcement text not null default ''
);
insert into public.itb_config (id) values (1) on conflict (id) do nothing;

-- published (encrypted) reports and the list of published towns
create table if not exists public.itb_reports (
  key text primary key, tk text not null, v int not null default 1,
  iv text not null, ct text not null, updated_ts bigint not null
);
create table if not exists public.itb_towns (
  tk text primary key, name text not null, updated_ts bigint not null
);

-- daily Memo Skipper record: one row per user, day (Bangladesh time) and delivery man
create table if not exists public.itb_memo_log (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.itb_users(id) on delete cascade,
  log_date date not null,
  dm_name text not null,
  total int not null default 0, valid int not null default 0, damage int not null default 0,
  payout int not null default 0, skipped int not null default 0,
  skipped_amount numeric(14,2) not null default 0, min_amount numeric(12,2),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date, dm_name)
);

-- lock every table: RLS on, no policies, no direct access for the public roles
do $$
declare t text;
begin
  foreach t in array array['itb_users','itb_regs','itb_sessions','itb_config','itb_reports','itb_towns','itb_memo_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- -------------------------------------------------------- private helpers ---
create or replace function itb_private.tk(t text) returns text
language sql immutable set search_path = public as $$
  select translate(upper(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')), '.#$[]/', '______')
$$;

create or replace function itb_private.user_json(u public.itb_users) returns json
language sql stable as $$
  select json_build_object('id', u.id, 'loginId', u.login_id, 'role', u.role, 'status', u.status, 'town', u.town, 'sap', u.sap,
    'itName', u.it_name, 'house', u.house, 'email', u.email, 'itPhone', u.it_phone, 'mgrPhone', u.mgr_phone,
    'expiresOn', u.expires_on,
    'daysLeft', case when u.expires_on is null then null else u.expires_on - (now() at time zone 'Asia/Dhaka')::date end)
$$;

-- validates a session token; p_admin = require an administrator
create or replace function itb_private.who(p_token text, p_admin boolean default false) returns public.itb_users
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users; c public.itb_config;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Please log in first.'; end if;
  select x.* into u from public.itb_users x join public.itb_sessions s on s.user_id = x.id
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex') and s.expires_at > now();
  if not found then raise exception 'Your session has expired. Please log in again.'; end if;
  if u.status <> 'active' then raise exception 'Your account is not active. Please contact the administrator.'; end if;
  if u.role <> 'admin' and u.expires_on is not null and (now() at time zone 'Asia/Dhaka')::date > u.expires_on then
    raise exception 'Your access ended on %. Please contact the administrator.', to_char(u.expires_on, 'DD Mon YYYY');
  end if;
  if p_admin and u.role <> 'admin' then raise exception 'Administrator access only.'; end if;
  if u.role <> 'admin' then
    select * into c from public.itb_config where id = 1;
    if found and not c.enabled then raise exception '%', coalesce(nullif(c.message, ''), 'The app is temporarily unavailable.'); end if;
  end if;
  return u;
end $$;

-- ------------------------------------------------------------ public API -----
create or replace function public.itb_config_get() returns json
language sql security definer set search_path = public as $$
  select json_build_object('enabled', enabled, 'registrationOpen', registration_open, 'message', message, 'announcement', announcement)
  from public.itb_config where id = 1
$$;

create or replace function public.itb_register(p_town text, p_sap text, p_it_name text, p_house text, p_email text, p_it_phone text, p_mgr_phone text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare c public.itb_config; r public.itb_regs;
        v_town text := regexp_replace(btrim(coalesce(p_town, '')), '\s+', ' ', 'g');
        v_sap  text := btrim(coalesce(p_sap, ''));
        v_name text := regexp_replace(btrim(coalesce(p_it_name, '')), '\s+', ' ', 'g');
        v_house text := regexp_replace(btrim(coalesce(p_house, '')), '\s+', ' ', 'g');
        v_email text := btrim(coalesce(p_email, ''));
        v_itp text := btrim(coalesce(p_it_phone, ''));
        v_mgp text := btrim(coalesce(p_mgr_phone, ''));
begin
  select * into c from public.itb_config where id = 1;
  if found and not c.enabled then raise exception '%', coalesce(nullif(c.message, ''), 'The app is temporarily unavailable.'); end if;
  if found and not c.registration_open then raise exception 'New registrations are closed at the moment.'; end if;
  if v_town = '' or v_sap = '' or v_name = '' or v_house = '' or v_email = '' or v_itp = '' or v_mgp = '' then raise exception 'Please fill in all the fields.'; end if;
  if length(v_town) > 80 or length(v_sap) > 40 or length(v_name) > 80 or length(v_house) > 120 or length(v_email) > 120 then raise exception 'One of the fields is too long.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'Enter a valid email address.'; end if;
  if v_itp !~ '^\+?[0-9][0-9 -]{8,19}$' then raise exception 'Enter a valid IT phone number.'; end if;
  if v_mgp !~ '^\+?[0-9][0-9 -]{8,19}$' then raise exception 'Enter a valid manager phone number.'; end if;
  if exists (select 1 from public.itb_regs where status = 'pending' and upper(sap) = upper(v_sap)) then
    raise exception 'An application with this SAP code is already waiting for approval.'; end if;
  if (select count(*) from public.itb_regs where status = 'pending') >= 300 then raise exception 'Too many pending applications. Please try again later.'; end if;
  insert into public.itb_regs (town, sap, it_name, house, email, it_phone, mgr_phone)
  values (v_town, v_sap, v_name, v_house, v_email, v_itp, v_mgp) returning * into r;
  return r.id::text;
end $$;

create or replace function public.itb_reg_status(p_id text) returns json
language plpgsql security definer set search_path = public as $$
declare r public.itb_regs; v uuid;
begin
  begin v := p_id::uuid; exception when others then return null; end;
  select * into r from public.itb_regs where id = v;
  if not found then return null; end if;
  return json_build_object('status', r.status, 'loginId', r.login_id, 'reason', r.reason);
end $$;

-- login: wrong-password problems are RETURNED (not raised) so the attempt counter is saved
create or replace function public.itb_login(p_login_id text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users; c public.itb_config; tok text;
        v_id text := upper(btrim(coalesce(p_login_id, '')));
        v_pw text := coalesce(p_password, '');
begin
  select * into u from public.itb_users where login_id = v_id;
  if not found then
    perform crypt(v_pw, gen_salt('bf'));
    return json_build_object('error', 'Wrong User ID or password.');
  end if;
  if u.locked_until is not null and u.locked_until > now() then
    return json_build_object('error', 'Too many wrong attempts. Please try again in a few minutes.');
  end if;
  if crypt(v_pw, u.pass_hash) <> u.pass_hash then
    update public.itb_users
       set failed = case when failed >= 4 then 0 else failed + 1 end,
           locked_until = case when failed >= 4 then now() + interval '10 minutes' else locked_until end
     where id = u.id;
    return json_build_object('error', 'Wrong User ID or password.');
  end if;
  if u.status <> 'active' then
    return json_build_object('error', 'Your account is suspended. Please contact the administrator.');
  end if;
  if u.role <> 'admin' and u.expires_on is not null and (now() at time zone 'Asia/Dhaka')::date > u.expires_on then
    return json_build_object('error', 'Your access ended on ' || to_char(u.expires_on, 'DD Mon YYYY') || '. Please contact the administrator.');
  end if;
  if u.role <> 'admin' then
    select * into c from public.itb_config where id = 1;
    if found and not c.enabled then
      return json_build_object('error', coalesce(nullif(c.message, ''), 'The app is temporarily unavailable. Please try again later.'));
    end if;
  end if;
  update public.itb_users set failed = 0, locked_until = null, last_login = now() where id = u.id;
  delete from public.itb_sessions where expires_at < now();
  tok := encode(gen_random_bytes(32), 'hex');
  insert into public.itb_sessions (token_hash, user_id, expires_at) values (encode(digest(tok, 'sha256'), 'hex'), u.id, now() + interval '30 days');
  return json_build_object('token', tok, 'user', itb_private.user_json(u));
end $$;

create or replace function public.itb_me(p_token text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users;
begin
  u := itb_private.who(p_token);
  update public.itb_sessions set expires_at = now() + interval '30 days' where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  return itb_private.user_json(u);
end $$;

create or replace function public.itb_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.itb_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- ----------------------------------------------- published reports (users) ---
create or replace function public.itb_towns_list(p_token text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users; j json;
begin
  u := itb_private.who(p_token);
  select coalesce(json_agg(json_build_object('name', name) order by name), '[]'::json) into j
    from public.itb_towns where u.role = 'admin' or tk = itb_private.tk(u.town);
  return j;
end $$;

create or replace function public.itb_data_put(p_token text, p_key text, p_town text, p_v int, p_iv text, p_ct text, p_ts bigint) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users; v_tk text := itb_private.tk(p_town);
begin
  u := itb_private.who(p_token);
  if v_tk = '' then raise exception 'Town name is required.'; end if;
  if u.role <> 'admin' and v_tk <> itb_private.tk(u.town) then raise exception 'Your account is registered for % only.', u.town; end if;
  if p_key is null or length(p_key) < 16 or p_ct is null or length(p_ct) > 40000000 then raise exception 'Invalid data.'; end if;
  insert into public.itb_reports (key, tk, v, iv, ct, updated_ts) values (p_key, v_tk, coalesce(p_v, 1), p_iv, p_ct, p_ts)
  on conflict (key) do update set tk = excluded.tk, v = excluded.v, iv = excluded.iv, ct = excluded.ct, updated_ts = excluded.updated_ts;
  insert into public.itb_towns (tk, name, updated_ts) values (v_tk, regexp_replace(btrim(p_town), '\s+', ' ', 'g'), p_ts)
  on conflict (tk) do update set name = excluded.name, updated_ts = excluded.updated_ts;
end $$;

create or replace function public.itb_data_get(p_token text, p_key text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users; r public.itb_reports;
begin
  u := itb_private.who(p_token);
  select * into r from public.itb_reports where key = p_key;
  if not found then return null; end if;
  if u.role <> 'admin' and r.tk <> itb_private.tk(u.town) then return null; end if;
  return json_build_object('v', r.v, 'iv', r.iv, 'ct', r.ct, 'updatedAt', r.updated_ts);
end $$;

-- ------------------------------------------------------------ admin API ------
create or replace function public.itb_admin_regs(p_token text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; j json;
begin
  a := itb_private.who(p_token, true);
  select coalesce(json_agg(json_build_object('_id', id, 'town', town, 'sap', sap, 'itName', it_name, 'house', house, 'email', email,
      'itPhone', it_phone, 'mgrPhone', mgr_phone, 'status', status, 'reason', reason, 'loginId', login_id,
      'createdAt', (extract(epoch from created_at) * 1000)::bigint) order by created_at desc), '[]'::json) into j
    from public.itb_regs;
  return j;
end $$;

create or replace function public.itb_admin_users(p_token text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; j json;
begin
  a := itb_private.who(p_token, true);
  select coalesce(json_agg(json_build_object('_id', id, 'loginId', login_id, 'role', role, 'status', status, 'town', town, 'sap', sap,
      'itName', it_name, 'house', house, 'email', email, 'itPhone', it_phone, 'mgrPhone', mgr_phone,
      'createdAt', (extract(epoch from created_at) * 1000)::bigint, 'expiresOn', expires_on,
      'daysLeft', case when expires_on is null then null else expires_on - (now() at time zone 'Asia/Dhaka')::date end) order by login_id), '[]'::json) into j
    from public.itb_users;
  return j;
end $$;

drop function if exists public.itb_admin_approve(text, text, text, text, text);
create or replace function public.itb_admin_approve(p_token text, p_reg_id text, p_town text, p_login_id text, p_password text, p_expires_on text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; r public.itb_regs; v_exp date;
        v_id text := upper(btrim(coalesce(p_login_id, '')));
        v_town text := regexp_replace(btrim(coalesce(p_town, '')), '\s+', ' ', 'g');
begin
  a := itb_private.who(p_token, true);
  select * into r from public.itb_regs where id = p_reg_id::uuid;
  if not found then raise exception 'Application not found.'; end if;
  if r.status <> 'pending' then raise exception 'This application has already been processed.'; end if;
  if v_town = '' then raise exception 'Town is required.'; end if;
  if v_id !~ '^[A-Z0-9_-]{3,30}$' then raise exception 'User ID: 3 to 30 letters, numbers, - or _ only.'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  begin v_exp := nullif(btrim(coalesce(p_expires_on, '')), '')::date; exception when others then raise exception 'Invalid access end date.'; end;
  if exists (select 1 from public.itb_users where login_id = v_id) then raise exception 'User ID % is already taken.', v_id; end if;
  insert into public.itb_users (login_id, pass_hash, role, status, town, sap, it_name, house, email, it_phone, mgr_phone, reg_id, expires_on)
  values (v_id, crypt(p_password, gen_salt('bf')), 'user', 'active', v_town, r.sap, r.it_name, r.house, r.email, r.it_phone, r.mgr_phone, r.id, v_exp);
  update public.itb_regs set status = 'approved', login_id = v_id, town = v_town, decided_at = now() where id = r.id;
  return json_build_object('loginId', v_id);
end $$;

create or replace function public.itb_admin_reject(p_token text, p_reg_id text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users;
begin
  a := itb_private.who(p_token, true);
  update public.itb_regs set status = 'rejected', reason = left(coalesce(p_reason, ''), 300), decided_at = now()
   where id = p_reg_id::uuid and status = 'pending';
  if not found then raise exception 'Application not found or already processed.'; end if;
end $$;

create or replace function public.itb_admin_set_status(p_token text, p_user_id text, p_status text) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; v_uid bigint := p_user_id::bigint;
begin
  a := itb_private.who(p_token, true);
  if p_status not in ('active', 'suspended') then raise exception 'Invalid status.'; end if;
  if v_uid = a.id then raise exception 'You cannot change your own account here.'; end if;
  update public.itb_users set status = p_status where id = v_uid;
  if not found then raise exception 'User not found.'; end if;
  if p_status = 'suspended' then delete from public.itb_sessions where user_id = v_uid; end if;
end $$;

create or replace function public.itb_admin_reset_pw(p_token text, p_user_id text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; v_uid bigint := p_user_id::bigint;
begin
  a := itb_private.who(p_token, true);
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  update public.itb_users set pass_hash = crypt(p_password, gen_salt('bf')), failed = 0, locked_until = null where id = v_uid;
  if not found then raise exception 'User not found.'; end if;
  delete from public.itb_sessions where user_id = v_uid;
end $$;

create or replace function public.itb_admin_remove(p_token text, p_user_id text) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; v_uid bigint := p_user_id::bigint;
begin
  a := itb_private.who(p_token, true);
  if v_uid = a.id then raise exception 'You cannot remove your own account.'; end if;
  delete from public.itb_users where id = v_uid and role <> 'admin';
  if not found then raise exception 'User not found.'; end if;
end $$;

create or replace function public.itb_admin_config_set(p_token text, p_enabled boolean, p_reg_open boolean, p_message text, p_announcement text) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users;
begin
  a := itb_private.who(p_token, true);
  update public.itb_config set enabled = coalesce(p_enabled, true), registration_open = coalesce(p_reg_open, true),
         message = left(coalesce(p_message, ''), 300), announcement = left(coalesce(p_announcement, ''), 300) where id = 1;
end $$;

create or replace function public.itb_admin_set_expiry(p_token text, p_user_id text, p_expires_on text) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; v_uid bigint := p_user_id::bigint; v_exp date;
begin
  a := itb_private.who(p_token, true);
  begin v_exp := nullif(btrim(coalesce(p_expires_on, '')), '')::date; exception when others then raise exception 'Invalid access end date.'; end;
  update public.itb_users set expires_on = v_exp where id = v_uid and role <> 'admin';
  if not found then raise exception 'User not found.'; end if;
end $$;

-- ------------------------------------------------- daily Memo Skipper record --
create or replace function public.itb_memo_log_save(p_token text, p_rows json) returns void
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users; r json; n int := 0; v_date date := (now() at time zone 'Asia/Dhaka')::date;
begin
  u := itb_private.who(p_token);
  if p_rows is null or json_typeof(p_rows) <> 'array' then raise exception 'Invalid data.'; end if;
  for r in select value from json_array_elements(p_rows) loop
    n := n + 1;
    if n > 300 then raise exception 'Too many rows.'; end if;
    insert into public.itb_memo_log (user_id, log_date, dm_name, total, valid, damage, payout, skipped, skipped_amount, min_amount, updated_at)
    values (u.id, v_date, left(coalesce(nullif(btrim(r->>'dm'), ''), '-'), 120),
            greatest(0, coalesce((r->>'total')::int, 0)), greatest(0, coalesce((r->>'valid')::int, 0)), greatest(0, coalesce((r->>'damage')::int, 0)),
            greatest(0, coalesce((r->>'payout')::int, 0)), greatest(0, coalesce((r->>'skipped')::int, 0)),
            greatest(0, coalesce((r->>'skippedAmount')::numeric, 0)), (r->>'minAmount')::numeric, now())
    on conflict (user_id, log_date, dm_name) do update
      set total = excluded.total, valid = excluded.valid, damage = excluded.damage, payout = excluded.payout, skipped = excluded.skipped,
          skipped_amount = excluded.skipped_amount, min_amount = excluded.min_amount, updated_at = now();
  end loop;
end $$;

create or replace function public.itb_memo_log_mine(p_token text, p_days int default 30) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare u public.itb_users; j json;
        v_from date := (now() at time zone 'Asia/Dhaka')::date - (least(greatest(coalesce(p_days, 30), 1), 366) - 1);
begin
  u := itb_private.who(p_token);
  select coalesce(json_agg(x order by x."date" desc), '[]'::json) into j from (
    select l.log_date as "date", count(*)::int as "dms", sum(l.total)::int as "total", sum(l.valid)::int as "valid", sum(l.damage)::int as "damage",
           sum(l.payout)::int as "payout", sum(l.skipped)::int as "skipped", round(sum(l.skipped_amount), 2) as "skippedAmount"
      from public.itb_memo_log l where l.user_id = u.id and l.log_date >= v_from group by l.log_date) x;
  return j;
end $$;

create or replace function public.itb_admin_memo_log(p_token text, p_from text, p_to text) returns json
language plpgsql security definer set search_path = public, extensions, itb_private as $$
declare a public.itb_users; j json; v_from date; v_to date;
begin
  a := itb_private.who(p_token, true);
  begin
    v_to := coalesce(nullif(btrim(coalesce(p_to, '')), '')::date, (now() at time zone 'Asia/Dhaka')::date);
    v_from := coalesce(nullif(btrim(coalesce(p_from, '')), '')::date, v_to - 29);
  exception when others then raise exception 'Invalid date.'; end;
  select coalesce(json_agg(y order by y."date" desc, y."loginId"), '[]'::json) into j from (
    select l.log_date as "date", us.login_id as "loginId", us.town as "town", us.it_name as "itName",
           sum(l.total)::int as "total", sum(l.valid)::int as "valid", sum(l.damage)::int as "damage", sum(l.payout)::int as "payout",
           sum(l.skipped)::int as "skipped", round(sum(l.skipped_amount), 2) as "skippedAmount"
      from public.itb_memo_log l join public.itb_users us on us.id = l.user_id
     where l.log_date between v_from and v_to group by l.log_date, us.login_id, us.town, us.it_name) y;
  return j;
end $$;

-- ------------------------------------------------------------- permissions ---
-- only the itb_* functions in the public schema are callable from the app
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'itb\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
