#!/usr/bin/env bash
# Verifies supabase/schema.sql against a real Postgres, as the anon role.
#   createdb mp && psql -d mp -f supabase/schema.sql && bash test/schema.sh
# Set PGHOST/PGPORT/MPDB as needed. Mirrors Supabase by expecting an `anon` role.
set -u
P="psql -h /tmp -p 5433 -U postgres -d ${MPDB:-mp} -qAt"
pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1 | $3"; fi; }

CODE=$($P -c "set role anon; select public.mp_create('Sal','Wicker Park',41.9088,-87.6796)::json->>'code';")
ok "mp_create returns a session code" "$([ ${#CODE} -eq 10 ] && echo 1 || echo 0)" "got '$CODE'"

PID2=$($P -c "set role anon; select public.mp_join('$CODE','Dana','Hyde Park',41.7943,-87.5907)::json->>'participant_id';")
ok "mp_join adds a second person" "$([ ${#PID2} -eq 36 ] && echo 1 || echo 0)" "got '$PID2'"

N=$($P -c "set role anon; select json_array_length(public.mp_state('$CODE')->'people');")
ok "mp_state lists both people" "$([ "$N" = "2" ] && echo 1 || echo 0)" "n=$N"

L=$($P -c "set role anon; select public.mp_state('$CODE')->'people'->0->>'label';")
ok "the place name is returned to everyone, not just coordinates" "$([ "$L" = "Wicker Park" ] && echo 1 || echo 0)" "got '$L'"
$P -c "set role anon; select public.mp_update('$CODE','$PID2','Dana','Logan Square',41.92,-87.70);" >/dev/null
L2=$($P -c "set role anon; select public.mp_state('$CODE')->'people'->1->>'label';")
ok "an updated place name propagates" "$([ "$L2" = "Logan Square" ] && echo 1 || echo 0)" "got '$L2'"

# 8-person cap
for i in 3 4 5 6 7 8; do $P -c "set role anon; select public.mp_join('$CODE','P$i','Somewhere',41.8,-87.6);" >/dev/null; done
N=$($P -c "set role anon; select json_array_length(public.mp_state('$CODE')->'people');")
ok "session fills to 8" "$([ "$N" = "8" ] && echo 1 || echo 0)" "n=$N"
ERR=$($P -c "set role anon; select public.mp_join('$CODE','Ninth','Somewhere',41.8,-87.6);" 2>&1 | grep -c session_full)
ok "9th person refused with session_full" "$([ "$ERR" -ge 1 ] && echo 1 || echo 0)" "$ERR"

# votes
$P -c "set role anon; select public.mp_vote('$CODE','$PID2','node/123',1);" >/dev/null
V=$($P -c "set role anon; select json_array_length(public.mp_state('$CODE')->'votes');")
ok "vote recorded" "$([ "$V" = "1" ] && echo 1 || echo 0)" "v=$V"
$P -c "set role anon; select public.mp_vote('$CODE','$PID2','node/123',0);" >/dev/null
V=$($P -c "set role anon; select json_array_length(public.mp_state('$CODE')->'votes');")
ok "vote cleared with dir=0" "$([ "$V" = "0" ] && echo 1 || echo 0)" "v=$V"

# leave
$P -c "set role anon; select public.mp_leave('$CODE','$PID2');" >/dev/null
N=$($P -c "set role anon; select json_array_length(public.mp_state('$CODE')->'people');")
ok "mp_leave removes a participant" "$([ "$N" = "7" ] && echo 1 || echo 0)" "n=$N"

# bad code
ERR=$($P -c "set role anon; select public.mp_state('doesnotexist');" 2>&1 | grep -c session_not_found)
ok "unknown code raises session_not_found" "$([ "$ERR" -ge 1 ] && echo 1 || echo 0)" "$ERR"

# ---- the security claims ----
E1=$($P -c "set role anon; select count(*) from public.sessions;" 2>&1 | grep -c "permission denied")
ok "anon CANNOT read the sessions table directly" "$([ "$E1" -ge 1 ] && echo 1 || echo 0)" "$E1"
E2=$($P -c "set role anon; select count(*) from public.participants;" 2>&1 | grep -c "permission denied")
ok "anon CANNOT read participants (no location dumping)" "$([ "$E2" -ge 1 ] && echo 1 || echo 0)" "$E2"
E3=$($P -c "set role anon; select count(*) from public.votes;" 2>&1 | grep -c "permission denied")
ok "anon CANNOT read votes" "$([ "$E3" -ge 1 ] && echo 1 || echo 0)" "$E3"
E4=$($P -c "set role anon; insert into public.sessions(code) values ('hack');" 2>&1 | grep -c "permission denied")
ok "anon CANNOT insert rows directly" "$([ "$E4" -ge 1 ] && echo 1 || echo 0)" "$E4"
E5=$($P -c "set role anon; select public.mp_session('$CODE');" 2>&1 | grep -c "permission denied")
ok "internal helper mp_session is not callable by anon" "$([ "$E5" -ge 1 ] && echo 1 || echo 0)" "$E5"
E6=$($P -c "set role anon; select public.mp_gc();" 2>&1 | grep -c "permission denied")
ok "internal helper mp_gc is not callable by anon" "$([ "$E6" -ge 1 ] && echo 1 || echo 0)" "$E6"

# expiry + cascade
$P -c "update public.sessions set expires_at = now() - interval '1 hour' where code='$CODE';" >/dev/null
ERR=$($P -c "set role anon; select public.mp_state('$CODE');" 2>&1 | grep -c session_not_found)
ok "an expired session is unreachable" "$([ "$ERR" -ge 1 ] && echo 1 || echo 0)" "$ERR"
$P -c "set role anon; select public.mp_create('gc','x',1,1);" >/dev/null
LEFT=$($P -c "select count(*) from public.participants p join public.sessions s on s.id=p.session_id where s.code='$CODE';")
ok "expired session's participants are deleted (gc + cascade)" "$([ "$LEFT" = "0" ] && echo 1 || echo 0)" "left=$LEFT"

# codes are unique and random
D=$($P -c "set role anon; select count(distinct public.mp_create('x','y',1,1)::json->>'code') from generate_series(1,50);")
ok "50 generated codes are all distinct" "$([ "$D" = "50" ] && echo 1 || echo 0)" "d=$D"

echo ""; echo "$pass passed, $fail failed"
[ "$fail" = "0" ]
