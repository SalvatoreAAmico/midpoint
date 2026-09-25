-- Fix: other people saw your pin but not where you were.
--
-- Participants stored a name and coordinates but never the place name, so the
-- text someone typed ("Hyde Park, Chicago") or the neighbourhood resolved from
-- their GPS stayed on their own device. Everyone else saw a dot with no label,
-- and on reload it looked to the person themselves as though their location had
-- been lost — so they typed it again, every time.
--
-- Safe to run on an existing project. Adds one column and replaces three
-- functions; no data is lost. Session rows in flight keep working, they simply
-- have an empty label until the next update.

alter table public.participants
  add column if not exists label text not null default '';

-- The argument lists change, so the old versions are dropped rather than
-- overloaded: two functions of the same name with different signatures would
-- make every call ambiguous. The replacements use "or replace" so that running
-- this file on a project that already has it is a harmless no-op rather than an
-- error a third of the way through, with the rest of the file unapplied.
drop function if exists public.mp_create(text, double precision, double precision);
drop function if exists public.mp_join(text, text, double precision, double precision);
drop function if exists public.mp_update(text, uuid, text, double precision, double precision);

create or replace function public.mp_create(
  p_name text, p_label text, p_lat double precision, p_lon double precision)
returns json
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_pid uuid;
begin
  perform public.mp_gc();
  loop
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

-- mp_state has the same signature, so replacing it keeps its grant.
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

-- Dropping a function drops its grants with it.
grant execute on function public.mp_create(text, text, double precision, double precision)
  to anon, authenticated;
grant execute on function public.mp_join(text, text, text, double precision, double precision)
  to anon, authenticated;
grant execute on function public.mp_update(text, uuid, text, text, double precision, double precision)
  to anon, authenticated;
