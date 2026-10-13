-- Aggregate counters, so we stop flying blind.
--
-- Four questions we currently cannot answer: does anyone finish a search, do
-- groups of more than one actually form, does anyone reach a decision, and does
-- anyone save a group to come back to. None of them need to know anything about
-- a person.
--
-- What this deliberately does NOT store: no participant id, no session code, no
-- coordinates, no place names, no device or user agent, no IP, no timestamp
-- finer than the day. There is no row that belongs to anybody. Day granularity
-- is the point -- a per-event log with precise times could be correlated with a
-- session, and then it would be personal data wearing a counter's clothes.
--
-- Safe to run on an existing project: one new table and one new function.

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
