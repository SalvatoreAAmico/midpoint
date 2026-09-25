-- Share one search with the whole session.
--
-- Each device was searching on its own, so two people could be looking at
-- different lists while voting on what they assumed was the same one. A search
-- already computes travel times for everybody — one Overpass call and one OSRM
-- matrix covering all people against all venues — so the result is the group's
-- result, not the searcher's. Sharing it means one search serves everyone, and
-- halves the calls to the free services the app depends on.
--
-- Safe to run on an existing project: three nullable columns and one new
-- function. Sessions in flight are unaffected.

alter table public.sessions
  add column if not exists results     jsonb,
  add column if not exists results_by  uuid,
  add column if not exists results_at  timestamptz;

create or replace function public.mp_results(
  p_code text, p_participant uuid, p_results jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare s public.sessions;
begin
  s := public.mp_session(p_code);
  -- Guard the size: a runaway payload would be replicated to every device on
  -- every poll.
  if p_results is not null and length(p_results::text) > 200000 then
    raise exception 'results_too_large' using errcode = 'program_limit_exceeded';
  end if;
  update public.sessions
     set results = p_results, results_by = p_participant, results_at = now()
   where id = s.id;
end $$;

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

grant execute on function public.mp_results(text, uuid, jsonb) to anon, authenticated;
