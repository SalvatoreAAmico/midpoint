#!/usr/bin/env bash
# Brings up a throwaway Postgres 16 on /tmp:5433 and loads supabase/schema.sql,
# so test/schema.sh can run against real Postgres. Safe to re-run; it starts
# from scratch every time. Containers are ephemeral, so expect to need this
# after any restart -- a dead socket makes every schema assertion fail at once,
# which looks like 20 broken features and is really just a stopped server.
set -eu
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
D=/tmp/mpdata
# initdb refuses to run as root, so own the cluster with an unprivileged user.
if [ "$(id -u)" = "0" ]; then
  id pg >/dev/null 2>&1 || useradd -m -s /bin/bash pg
  AS="su pg -c"
  chmod 1777 /tmp
else
  AS="bash -c"
fi
$AS "$PGBIN/pg_ctl -D $D stop" >/dev/null 2>&1 || true
rm -rf $D; mkdir -p $D
[ "$(id -u)" = "0" ] && chown pg:pg $D
chmod 700 $D
$AS "$PGBIN/initdb -D $D -U postgres --auth=trust" >/tmp/initdb.log 2>&1
$AS "$PGBIN/pg_ctl -D $D -o '-p 5433 -k /tmp -c listen_addresses=\"\"' -l /tmp/pg.log start" >/dev/null
psql -h /tmp -p 5433 -U postgres -qAt \
  -c "create role anon nologin; create role authenticated nologin; create role service_role nologin;" >/dev/null
psql -h /tmp -p 5433 -U postgres -qAt -c "create database mp;" >/dev/null
psql -h /tmp -p 5433 -U postgres -d mp -v ON_ERROR_STOP=1 -q -f supabase/schema.sql >/dev/null
echo "postgres up on /tmp:5433, database mp loaded -- now: bash test/schema.sh"
