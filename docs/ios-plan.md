# The iOS app — how we build it

`ROADMAP-NATIVE.md` is the *why*: what native buys, what it costs, and the
decision to build in Swift instead of wrapping the web app. This is the *how*:
the architecture, the order of work, and what has to stay true while two
clients share one backend.

Written 2026-10-13 against build `0733e01`. Nothing here is built yet.

---

## 0. The gate, stated honestly

The pre-port checklist in `ROADMAP-NATIVE.md` still has "used for one real
meetup" unticked. The plan below is ordered so that the first two phases cost
nothing if the answer comes back "the suggestions are not good": phase 1 is
pure logic with no UI, and it runs on Linux. **Do not start the SwiftUI shell
(phase 2) until one real meetup has happened.** A native shell does not save
bad suggestions; it just makes them slower to fix.

## 1. What carries over, and what doesn't

| Web | iOS | How |
|---|---|---|
| Scoring, fairness, outliers, "together" detection | `MidPntCore` | Port line for line |
| `isOpenNow`, `priceLevel`, `isChain`, `searchCats`, `tagFilter` | `MidPntCore` | Port line for line |
| `CATALOG` (38 categories), `CHAIN_NAMES` | `MidPntCore` | Generated JSON, not hand-copied — see §4 |
| Nominatim / Overpass / OSRM calls | `MidPntCore` | `URLSession`, same two-calls-per-search budget |
| `sync.js` | `MidPntCore.Sync` | Near 1:1; same `mp_*` RPCs, same spend guards |
| `supabase/schema.sql` | — | **Untouched.** The backend does not care who calls it |
| Rendering, chips, sheet, cards | SwiftUI | Rewrite |
| Leaflet + OSM tiles | MapKit for SwiftUI | Rewrite; also removes our OSM tile-policy exposure |
| Geolocation | CoreLocation | Rewrite (`CLLocationUpdate`, when-in-use only at first) |
| `localStorage` (`midpoint.*`) | `UserDefaults` / SwiftData | Same key names — see §6 |
| URL hash state, `?s=` invites | Universal Links | See §5 |
| Light mode tokens | Asset-catalog colours, Any/Dark | No in-app override (already decided) |

## 2. Architecture

```
ios/
  MidPntCore/               Swift package. No UIKit, no SwiftUI, no MapKit.
    Sources/MidPntCore/
      Geo.swift             haversine, centroid, outliers, together
      Scoring.swift         scoreVenues — SPREAD_WEIGHT 0.9, FLEX_WEIGHT 0.35
      Hours.swift           isOpenNow (returns nil when unparseable — never filter)
      Catalog.swift         loads catalog.json; searchCats, tagFilter
      Chains.swift          isChain
      Services/             Nominatim, Overpass (with mirror fallback), OSRM /table
      Sync/                 SupabaseRPC, SessionPoller, session models
    Resources/catalog.json  generated from app.js, never edited by hand
    Tests/MidPntCoreTests/  golden-vector tests against the JS (§4)
  MidPnt/                   the Xcode app target: SwiftUI, MapKit, CoreLocation
  MidPnt.xcodeproj
```

- **Swift 6, SwiftUI, Observation (`@Observable`), iOS 17 minimum.** iOS 17 is
  what gets us MapKit-for-SwiftUI and `CLLocationUpdate` without fallbacks; it
  covers the overwhelming majority of active iPhones. Raise to 18 only if a
  feature demands it.
- **No third-party dependencies.** The web app has none beyond Leaflet; the
  Supabase surface we use is eight `POST /rest/v1/rpc/*` calls, which is
  `URLSession` plus `Codable`, not an SDK.
- **`MidPntCore` builds and tests on Linux.** This matters more than it looks:
  only one of us needs a Mac, CI can run the core tests on a free Linux runner,
  and a cloud Claude Code session can work on the core with `swift test`. Keep
  it free of Apple-only frameworks to preserve that — `CoreLocation` types stay
  in the app target; the core takes plain `lat`/`lon`.
- **One state object per screen, not one global `state`.** `app.js` has a single
  mutable `state`; that is fine in 2,300 lines of JS and a trap in SwiftUI. The
  invariant that matters still holds: **costs are indexed by people, with `nil`
  for anyone not located** — model it as `[Person.ID: TimeInterval?]` so two
  index bases cannot exist at all, rather than relying on discipline.
- **Lives in this repo**, under `ios/`. The schema, the scoring tests and the
  session contract all live here, and drift between them is the main risk.
  Note GitHub Pages will publish `ios/` alongside the web app; the repo is
  public already, so this changes nothing.

## 3. The API budget, on a phone

The rule is unchanged: **a search is two HTTP calls, whatever the group size.**
Native changes three details:

- **Nominatim requires an identifying `User-Agent`.** A browser cannot set one;
  an app must: `MidPnt-iOS/<version> (<support email>)`. Without it we will be
  blocked, and that block would hit the web app's shared IP reputation too.
  Keep the 1 req/sec limit with a serial queue, and keep the in-memory cache.
- **Consider `CLGeocoder` / `MKGeocodingRequest` for typed places** — free,
  on-device rate limits rather than a shared public server. Not in v1: the
  place names it returns differ from `placeName()`'s, and live sessions show
  each person's label on everyone else's phone. Revisit once parity holds.
- **The OSRM demo server is the real scaling risk.** It carries no SLA and
  asks not to be used for heavy traffic. The web app's `~` fallback (straight
  line, marked estimated) must ship in v1 so an outage degrades rather than
  breaks. Self-hosting OSRM (and later OpenTripPlanner for transit) is the
  first real infrastructure cost, and the trigger is App Store traffic, not
  TestFlight.
- **Do not use `MKDirections` for travel times.** It is per pair, which is
  exactly the per-person, per-venue shape the budget forbids.
- **Polling stays 4s, foreground only.** `scenePhase != .active` replaces
  `visibilitychange`; the floor, the single in-flight request, the backoff and
  the 2-hour auto-leave all port as they are.

## 4. Keeping two implementations honest

In a live session whichever phone taps Find decides the list for everyone. If
the two scorers disagree, the ranking depends on who happened to search first —
an iPhone and a laptop holding the same inputs would give the group different
answers. Hand-porting and hoping is not enough.

1. **Golden vectors.** A new `test/golden.mjs` loads `app.js` the way
   `unit.mjs` already does, runs every pure function over a fixed set of
   inputs (the existing unit-test cases are a good start: the spread-beats-
   average case, volunteering in a pair, the chain-only area, past-midnight
   hours), and writes `ios/MidPntCore/Tests/golden/*.json`. The Swift tests
   assert the same outputs. Regenerating and diffing is a test, in the same
   spirit as `test/migrations.sh`: if `app.js` changes behaviour and the
   golden files are stale, the build fails.
2. **Generated catalog.** `CATALOG` and `CHAIN_NAMES` are data, and the
   reasoning behind them lives in `docs/osm-categories.md`. A script exports
   them to `catalog.json`; a test fails if the committed copy differs from what
   `app.js` produces. Categories are then edited in one place.
3. **A written session contract** (`docs/session-contract.md`, phase 1): the
   `mp_*` signatures, the `results` payload (`at`, `people`, `together`,
   `estimated`, `travel`, `venues[]` with costs ordered by `people`), the
   `filters` object, venue keys (`node/123`), and the error strings
   `session_not_found` / `session_full`. Both clients decode it with the same
   tolerance: unknown fields ignored, missing ones defaulted the way
   `applyRemoteFilters` and `adoptResults` already do.

## 5. Invites and links

Today an invite is `https://salvatoreaamico.com/midpoint/?s=<code>`, and the
no-backend mode carries the whole group in the hash. Both must keep working,
because for a long time most people tapping an invite will not have the app.

- **Universal Links** on `salvatoreaamico.com` for the `/midpoint/*` path: the
  app opens the link if installed; otherwise Safari opens the web app, which
  joins the same session. Requires
  `/.well-known/apple-app-site-association` at the **domain root** — that is
  the portfolio repo, not this one, and needs Sal (it is a file on his site,
  tied to his Team ID).
- The app parses `?s=` and the `#` hash with the same rules as
  `decodeState()`, including the old `o` open-now flag and the `n` default.
  Golden vectors cover this too.
- **Mixed sessions are the normal case:** one person on iOS, three on the web.
  The interop test for phase 3 is literally that — the app and
  `smoke-live.mjs`'s browser in one session against the real schema on
  `pg-up.sh`'s Postgres.
- The share sheet (`ShareLink`) replaces copy-the-code as the primary invite.

## 6. Local data

- Keep the `midpoint.*` key names in `UserDefaults` — `midpoint.session`,
  `midpoint.groups`, `midpoint.name`. Not for compatibility (an app cannot read
  Safari's storage) but so the house rule stays one rule rather than two.
- **Saved groups do not transfer from the web.** Say so in onboarding copy
  rather than let someone discover an empty list. An "Open in app" link from
  the web carrying the groups in the URL is a cheap fix if it turns out to
  matter.
- Saved groups can stay `Codable` in `UserDefaults` (twelve groups, a few KB).
  SwiftData earns its place only when history or recurring hangouts arrive.

## 7. Phases

Each phase ends in something that can be checked, not "progress".

### Phase 1 — the core, no UI *(no Mac needed; can start now)*
- `MidPntCore` package; port of every function `unit.mjs` exercises.
- `test/golden.mjs` + generated `catalog.json` + drift test.
- `docs/session-contract.md`.
- GitHub Actions: `node test/unit.mjs` and `swift test` on Linux.
- **Done when:** `swift test` passes every golden vector, and deliberately
  changing `SPREAD_WEIGHT` in `app.js` turns the Swift build red.

### Phase 2 — parity, solo *(needs a Mac; after the real meetup)*
- People (typed place or "Locate"), categories, search, map, ranked cards with
  per-person bars, "everyone together", outlier prompt, volunteering, lucky,
  when / price / chains / walk-drive, open in Maps, saved groups.
- Brand: asset-catalog colours mirroring the `:root` tokens; Fraunces,
  Archivo, JetBrains Mono bundled (all OFL — keep their licence texts in the
  bundle). "No raw colours outside tokens" becomes "no `Color(red:…)` outside
  the asset catalog".
- `PrivacyInfo.xcprivacy` (required; `UserDefaults` is a required-reason API),
  `NSLocationWhenInUseUsageDescription` written in the house voice.
- **Done when:** a TestFlight build on Sal's phone produces the same top five
  as the web app for the same inputs.

### Phase 3 — live sessions
- `Sync` port, poller tied to `scenePhase`, Universal Links, share sheet,
  `midpoint.session` resume (the duplicate-you-on-refresh bug has a native
  twin: relaunching from a link).
- **Done when:** a mixed iOS + web session agrees on roster, results order,
  shortlist and winner, tested on two real devices and in CI.

### Phase 4 — the reasons we went native
In this order, cheapest and least-rejected first:
1. **Live Activity** for the chosen spot ("Bow Truss — 12 min"). No server.
2. **Widget** for saved groups. No server.
3. **Push notifications.** This is the first change that needs server code
   and stores something new about people: an APNs device token per
   participant, a Supabase Edge Function holding the APNs key (a secret — it
   lives in Supabase, never in the repo), a schema migration as a new
   `fix-004-*.sql`, and a `PRIVACY.md` update. Design it as its own piece of
   work with its own review.
4. **Background location** last, in an update after approval, with usage data
   to justify it (per `ROADMAP-NATIVE.md`).

### Phase 5 — App Store
Everything in `TODO.md` under "Before the App Store": reviewed privacy policy
at a stable URL, support URL, nutrition labels, terms. Listing titled
"MidPnt — meet in the middle".

## 8. House rules, extended to Swift

Add these to `CLAUDE.md` when phase 1 lands:

- `cd ios/MidPntCore && swift test` joins the list of suites that run before
  every commit. So does the golden-vector drift check.
- A change to scoring, hours, chains or categories lands in **both** `app.js`
  and `MidPntCore` in the same commit, with regenerated golden files.
- The `?v=N` bump stays a web-only rule; the app's equivalent is
  `CFBundleVersion`, shown in Settings → About so "I don't see it" still has a
  number for an answer.
- Error red is still for things that are broken. A declined location prompt is
  not one, on any platform.
- Claim `ios/` in `handoff/NOW.md` like any other area.

## 9. Decisions only Sal can make

- [ ] **Who has the Mac**, and therefore who owns phases 2 onward.
- [ ] **Apple Developer Program** ($99/yr) — needed from phase 2 for TestFlight.
- [ ] **Bundle ID** — suggested `com.salvatoreaamico.midpnt`. Permanent once
      published.
- [ ] **AASA file on salvatoreaamico.com** for Universal Links (phase 3).
- [ ] **Minimum iOS version** — recommended 17.
- [ ] **Push in v1 or later?** Recommended later: it is the first server-side
      code and the first new stored data, and it needs something worth saying
      (recurring hangouts) before it is worth asking permission for.
