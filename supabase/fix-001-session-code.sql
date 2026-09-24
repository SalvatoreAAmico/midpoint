-- Two fixes for a project created from the first version of schema.sql.
--
-- 1. "function gen_random_bytes(integer) does not exist"
--
-- Supabase installs pgcrypto into the `extensions` schema, but these functions
-- pin search_path = public for safety, so pgcrypto's functions are invisible to
-- them. Session codes now come from gen_random_uuid(), which is core Postgres
-- and always reachable.
--
-- 2. The internal helpers mp_gc and mp_session were still callable by anyone.
--    Postgres grants EXECUTE on a new function to PUBLIC by default, so
--    revoking from anon alone left that default in place. Neither leaks data
--    without a session code, but they were never meant to be reachable.
--
-- Safe to run on a project that already has the schema: it replaces one
-- function, tightens two grants, and touches no data.

create or replace function public.mp_create(
  p_name text, p_lat double precision, p_lon double precision)
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
  insert into public.participants(session_id, name, lat, lon)
    values (v_id, coalesce(p_name, ''), p_lat, p_lon) returning id into v_pid;
  return json_build_object('code', v_code, 'participant_id', v_pid);
end $$;

grant execute on function public.mp_create(text, double precision, double precision)
  to anon, authenticated;

-- Lock down the internal helpers for real.
revoke all on function public.mp_gc()          from public, anon, authenticated;
revoke all on function public.mp_session(text) from public, anon, authenticated;
