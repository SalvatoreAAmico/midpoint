-- MidPnt — live session sync
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- SECURITY MODEL
-- The browser holds a public "anon" key, so anything the anon role can reach
-- directly is readable by anyone. These tables therefore have row-level
-- security ON and *no policies at all*, which denies the anon role every
-- direct read and write. The only way in is the mp_* functions below, each of
-- which demands the session's secret code. That stops someone from dumping
-- every session's coordinates with a single query.
--
-- Sessions self-destruct after 12 hours. Location data should not outlive the
-- meetup it was shared for.

-- ---------------------------------------------------------------- tables

create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  cats       jsonb not null default '["coffee"]'::jsonb,
  filters    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  -- One search serves the whole session: the result already covers everyone.
  results    jsonb,
  results_by uuid,
  results_at timestamptz
);

create table if not exists public.participants (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name       text not null default '',
  label      text not null default '',
  lat        double precision,
  lon        double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.votes (
  session_id     uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  venue_key      text not null,
  dir            smallint not null check (dir in (-1, 1)),
  primary key (session_id, participant_id, venue_key)
);

create index if not exists participants_session_idx on public.participants(session_id);
create index if not exists sessions_expiry_idx      on public.sessions(expires_at);

-- Deny-by-default: RLS on, zero policies, so anon cannot touch these directly.
alter table public.sessions     enable row level security;
alter table public.participants enable row level security;
alter table public.votes        enable row level security;

-- ------------------------------------------------------------- internals

create or replace function public.mp_gc() returns void
language sql security definer set search_path = public as $$
  delete from public.sessions where expires_at < now();
$$;

-- Resolve a session by its secret code, or fail. Every entry point uses this.
create or replace function public.mp_session(p_code text)
returns public.sessions
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  select * into s from public.sessions
    where code = lower(p_code) and expires_at > now();
  if not found then
    raise exception 'session_not_found' using errcode = 'no_data_found';
  end if;
  return s;
end $$;

-- --------------------------------------------------------------- reads

create or replace function public.mp_state(p_code text)
returns json
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  s := public.mp_session(p_code);
  return json_build_object(
    'code',       s.code,
    'cats',       s.cats,
    'filters',    s.filters,
    'expires_at', s.expires_at,
    'results',    s.results,
    'results_by', s.results_by,
    'results_at', s.results_at,
    'people', coalesce((
      select json_agg(json_build_object(
               'id', p.id, 'name', p.name, 'label', p.label,
               'lat', p.lat, 'lon', p.lon, 'updated_at', p.updated_at)
             order by p.created_at)
      from public.participants p where p.session_id = s.id), '[]'::json),
    'votes', coalesce((
      select json_agg(json_build_object(
               'participant_id', v.participant_id,
               'venue_key', v.venue_key, 'dir', v.dir))
      from public.votes v where v.session_id = s.id), '[]'::json)
  );
end $$;

-- --------------------------------------------------------------- writes

create or replace function public.mp_create(
  p_name text, p_label text, p_lat double precision, p_lon double precision)
returns json
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_pid uuid;
begin
  perform public.mp_gc();
  loop
    -- 10 hex chars ~ 40 random bits: enough that codes cannot be guessed in
    -- bulk. Derived from gen_random_uuid(), which is core Postgres, rather
    -- than pgcrypto's gen_random_bytes: Supabase installs extensions into a
    -- separate `extensions` schema, so a function pinned to search_path
    -- = public cannot see them.
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    exit when not exists (select 1 from public.sessions where code = v_code);
  end loop;
  insert into public.sessions(code) values (v_code) returning id into v_id;
  insert into public.participants(session_id, name, label, lat, lon)
    values (v_id, coalesce(p_name, ''), coalesce(p_label, ''), p_lat, p_lon)
    returning id into v_pid;
  return json_build_object('code', v_code, 'participant_id', v_pid);
end $$;

create or replace function public.mp_join(
  p_code text, p_name text, p_label text,
  p_lat double precision, p_lon double precision)
returns json
language plpgsql security definer set search_path = public as $$
declare s public.sessions; v_pid uuid; v_n int;
begin
  s := public.mp_session(p_code);
  select count(*) into v_n from public.participants where session_id = s.id;
  if v_n >= 8 then
    raise exception 'session_full' using errcode = 'check_violation';
  end if;
  insert into public.participants(session_id, name, label, lat, lon)
    values (s.id, coalesce(p_name, ''), coalesce(p_label, ''), p_lat, p_lon)
    returning id into v_pid;
  return json_build_object('participant_id', v_pid);
end $$;

create or replace function public.mp_update(
  p_code text, p_participant uuid, p_name text, p_label text,
  p_lat double precision, p_lon double precision)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  s := public.mp_session(p_code);
  update public.participants
     set name = coalesce(p_name, name),
         label = coalesce(p_label, label),
         lat = p_lat, lon = p_lon, updated_at = now()
   where id = p_participant and session_id = s.id;
end $$;

create or replace function public.mp_prefs(p_code text, p_cats jsonb, p_filters jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  s := public.mp_session(p_code);
  update public.sessions
     set cats = coalesce(p_cats, cats), filters = coalesce(p_filters, filters)
   where id = s.id;
end $$;

create or replace function public.mp_vote(
  p_code text, p_participant uuid, p_venue text, p_dir int)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  s := public.mp_session(p_code);
  if p_dir = 0 then
    delete from public.votes
      where session_id = s.id and participant_id = p_participant and venue_key = p_venue;
  else
    insert into public.votes(session_id, participant_id, venue_key, dir)
      values (s.id, p_participant, p_venue, sign(p_dir)::smallint)
      on conflict (session_id, participant_id, venue_key)
      do update set dir = excluded.dir;
  end if;
end $$;

create or replace function public.mp_results(
  p_code text, p_participant uuid, p_results jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  s := public.mp_session(p_code);
  if p_results is not null and length(p_results::text) > 200000 then
    raise exception 'results_too_large' using errcode = 'program_limit_exceeded';
  end if;
  update public.sessions
     set results = p_results, results_by = p_participant, results_at = now()
   where id = s.id;
end $$;

create or replace function public.mp_leave(p_code text, p_participant uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  s := public.mp_session(p_code);
  delete from public.participants where id = p_participant and session_id = s.id;
end $$;

-- ---------------------------------------------------------------- grants

revoke all on public.sessions, public.participants, public.votes from anon, authenticated;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, and PUBLIC
-- includes anon. Revoking from anon alone leaves that default in place, so the
-- internal helpers must be revoked from PUBLIC explicitly.
revoke all on function public.mp_gc()             from public, anon, authenticated;
revoke all on function public.mp_session(text)    from public, anon, authenticated;

grant execute on function public.mp_state(text)                     to anon, authenticated;
grant execute on function public.mp_create(text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.mp_join(text, text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.mp_update(text, uuid, text, text, double precision, double precision) to anon, authenticated;
grant execute on function public.mp_prefs(text, jsonb, jsonb)       to anon, authenticated;
grant execute on function public.mp_vote(text, uuid, text, int)     to anon, authenticated;
grant execute on function public.mp_leave(text, uuid)               to anon, authenticated;
grant execute on function public.mp_results(text, uuid, jsonb)      to anon, authenticated;

-- ----------------------------------------------------------- counters
-- Aggregate only: no participant id, no session code, no coordinates, no
-- device, no IP, no time finer than the day. There is no row here that belongs
-- to anybody. Mirrors supabase/fix-004-counters.sql.

create table if not exists public.stats (
  day     date not null default (now() at time zone 'utc')::date,
  metric  text not null,
  n       bigint not null default 0,
  primary key (day, metric)
);

alter table public.stats enable row level security;   -- no policies: deny all

-- The whitelist lives in the database, not the client. Two reasons: a caller
-- cannot invent a metric name, so nothing free-text (and therefore nothing
-- personal) can ever be written through this; and the table is bounded by
-- days x metrics, so a million junk calls still produce the same handful of
-- rows. Inflated numbers would be annoying; an unbounded table would be a bill.
create or replace function public.mp_tally(p_metric text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_metric not in (
    'session_created',   -- someone tapped Go live
    'session_joined',    -- someone opened an invite link and joined
    'search_solo',       -- a search with one located person
    'search_group',      -- a search with two or more: the group actually formed
    'vote',              -- a thumbs up or down
    'winner',            -- everyone voted and a spot was declared
    'group_saved'        -- saved a set of people to reuse
  ) then
    return;              -- unknown metric: ignore, never error, never store
  end if;

  insert into public.stats (day, metric, n)
  values ((now() at time zone 'utc')::date, p_metric, 1)
  on conflict (day, metric) do update set n = public.stats.n + 1;
end $$;

-- Anyone may count; nobody may read. Reading is for the project owner in the
-- Supabase SQL editor:
--   select day, metric, n from public.stats order by day desc, metric;
grant execute on function public.mp_tally(text) to anon, authenticated;
revoke all on public.stats from public, anon, authenticated;
