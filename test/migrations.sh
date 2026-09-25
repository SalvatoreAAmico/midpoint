#!/usr/bin/env bash
# Asserts that supabase/schema.sql already contains every supabase/fix-*.sql,
# and that each fix is safe to run twice.
#
# Sal runs the fix files by hand in the Supabase SQL editor against a live
# project, so the two can drift: a later fix that updates the migration and
# forgets schema.sql leaves a fresh install missing the change, and nothing
# would say so. Replaying every fix onto a fresh schema must be a no-op.
#   bash test/pg-up.sh && bash test/migrations.sh
set -u
P="psql -h /tmp -p 5433 -U postgres -qAt"
pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo "  FAIL $1 | $3"; fi; }

# Structure, function bodies (comments stripped -- a comment is not behaviour)
# and privileges. Privileges matter most: the whole security model is grants.
snap(){
  $P -d "$1" -c "select table_name,column_name,data_type,is_nullable
                   from information_schema.columns where table_schema='public' order by 1,2;"
  $P -d "$1" -c "select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid),
                        coalesce(array_to_string(p.proacl,','),'(default)'),
                        md5(regexp_replace(
                          regexp_replace(pg_get_functiondef(p.oid),
                                         '--[^' || chr(10) || ']*', '', 'g'),
                          '[[:space:]]+', ' ', 'g'))
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' order by 1,3;"
  $P -d "$1" -c "select c.relname, c.relrowsecurity,
                        coalesce((select count(*) from pg_policy where polrelid=c.oid),0)
                   from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='public' and c.relkind='r' order by 1;"
}

$P -c "drop database if exists mpref;" >/dev/null
$P -c "create database mpref;" >/dev/null
$P -d mpref -v ON_ERROR_STOP=1 -q -f supabase/schema.sql >/dev/null 2>&1
snap mpref > /tmp/mig-before.txt
ok "a fresh schema.sql loads cleanly" "$([ -s /tmp/mig-before.txt ] && echo 1 || echo 0)" "empty snapshot"

for f in supabase/fix-*.sql; do
  for pass_n in 1 2; do
    ERR=$($P -d mpref -v ON_ERROR_STOP=1 -f "$f" 2>&1 >/dev/null | grep -i error | head -1)
    ok "$(basename "$f") applies cleanly onto schema.sql (run $pass_n)" \
       "$([ -z "$ERR" ] && echo 1 || echo 0)" "$ERR"
  done
done

snap mpref > /tmp/mig-after.txt
D=$(diff /tmp/mig-before.txt /tmp/mig-after.txt | head -20)
ok "replaying every fix changes nothing: schema.sql is already current" \
   "$([ -z "$D" ] && echo 1 || echo 0)" "$(echo "$D" | tr '\n' ' ')"

echo ""; echo "$pass passed, $fail failed"
[ "$fail" = "0" ]
