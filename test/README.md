# Tests

## Unit — geo, scoring, opening hours
```
node test/unit.mjs
```
No dependencies. 151 assertions covering distance, centroid, the fairness
score, `opening_hours` parsing, and price-tag reading.

## Smoke — the real UI in a headless browser
```
cd test && npm install && cd ..
node test/smoke.mjs
```
Serves the app locally and drives it in mobile-sized Chromium with **every
OpenStreetMap response mocked**, so it runs offline and deterministically.
185 assertions covering the person rows and the 8-person cap, geocoding,
ranking, fairness bars, the open-now and price filters, voting, the
share-link round-trip, and straight-line fallback mode. Fails on any
uncaught JS error.

Set `CHROME_PATH` if Playwright's bundled browser isn't installed.

**These mocks prove the app's own logic, not the live APIs.** Nominatim,
Overpass, and OSRM are only exercised for real when the app runs in a
browser with network access.

## Golden — app.js against the iOS port
```
node test/golden.mjs           # check: fails if the vectors on disk are stale
node test/golden.mjs --write   # regenerate after an intended change to app.js
cd ios/MidPntCore && swift test
```
Runs every pure function the two clients share (distance, scoring, opening
hours, chains, category search, Overpass query building, venue parsing and
filtering, search area, link parsing, codenames, place names, saved groups)
over fixed inputs and writes the answers to `ios/MidPntCore/Tests/golden/`,
plus `catalog.json`, which the Swift package loads. The Swift tests assert the
same outputs. Timezone-independent: dates are `{day, h, m}`.

Two ways to go red, on purpose: change `app.js` and forget to regenerate, and
`golden.mjs` fails; regenerate and forget the Swift side, and `swift test` fails.

## iOS interop — the Swift client against the real schema
```
bash test/pg-up.sh && bash test/ios-interop.sh
```
`test/rpc-shim.mjs` answers `POST /rest/v1/rpc/mp_*` like PostgREST does, running each call as
`anon` against the throwaway Postgres, and checks the `apikey` header. The Swift `InteropTests`
(skipped unless `MP_RPC_URL` is set) drive `SessionClient` and two `AppModel`s through it.

## Schema — the real database

```
bash test/schema.sh
```
Runs `supabase/schema.sql` against a live Postgres and exercises every `mp_*`
function **as the `anon` role**, the same role the browser's key maps to.
27 assertions: the full create/join/state/vote/leave flow, the 8-person cap,
expiry and cascade delete, code uniqueness, and — most importantly — that anon
**cannot** read the tables directly or reach the internal helpers.

This is the suite that would have caught both bugs the mocked tests missed:
`gen_random_bytes` being invisible under `search_path = public`, and Postgres
granting EXECUTE on new functions to PUBLIC by default.

---

## Counts drift

The numbers above are a rough guide, not a contract — they were wrong by an
order of magnitude before anyone noticed. Each suite prints its own total when
it runs, and that is the number to trust.

Current totals: **165 / 185 / 99 / 27 / 8** across unit, smoke, smoke-live,
schema and migrations, plus 49 generated files checked by golden.mjs and 93 Swift tests (4 of them interop).

## In CI

`.github/workflows/tests.yml` runs all six on every push and pull request:
`unit` and `golden` on a bare runner, `smoke` and `smoke-live` with a
Playwright Chromium, and `schema` and `migrations` against a Postgres 16
service container (`PGHOST`/`PGPORT` override the local `/tmp:5433` default).
The `ios-app` job is `continue-on-error` until the SwiftUI layer compiles on a
Mac for the first time — a permanently red job trains everyone to ignore the
whole workflow.

Current totals: **165 / 185 / 106 / 34 / 10**, plus 49 golden files.
