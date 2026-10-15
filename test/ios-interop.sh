#!/usr/bin/env bash
# The Swift sync client against the REAL schema, as the anon role.
#   bash test/pg-up.sh && bash test/ios-interop.sh
# Starts test/rpc-shim.mjs (a PostgREST stand-in over the throwaway Postgres),
# runs the InteropTests in ios/MidPntCore against it, and stops the shim.
set -eu
cd "$(dirname "$0")/.."
PORT=${PORT:-8097}
node test/rpc-shim.mjs $PORT >/tmp/rpc-shim.log 2>&1 &
SHIM=$!
trap 'kill $SHIM 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do grep -q listening /tmp/rpc-shim.log 2>/dev/null && break; sleep 0.1; done
cd ios/MidPntCore
MP_RPC_URL=http://127.0.0.1:$PORT swift test --filter InteropTests 2>&1 | grep -E "error:|Executed .* tests|skipped|failed" | tail -8
