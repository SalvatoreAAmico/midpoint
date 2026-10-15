# Working on MidPnt

Read this before changing anything. It is the house rules, and most of them
exist because something broke once.

MidPnt finds a place to meet that is fair to everyone — not the geographic
middle, the *fair* middle. A café five minutes from you and forty from your
friend has a reasonable average and is the wrong answer. That distinction is
the entire product. Every competitor on the App Store computes the geographic
midpoint; we rank by real travel time with a penalty on the spread.

Two people work on this, each with their own Claude Code. See `handoff/` before
you start and after you finish.

---

## Run the tests. All of them. Before every commit.

```bash
node test/unit.mjs                                    # pure logic, <1s
cd test && npm install && cd ..                       # once, for the browser suites
CHROME_PATH=<path-to-chromium> node test/smoke.mjs    # the UI, ~60s
CHROME_PATH=<path-to-chromium> node test/smoke-live.mjs  # two phones, ~145s
bash test/pg-up.sh && bash test/schema.sh             # real Postgres, <2s
bash test/migrations.sh                               # schema/migration drift
node test/golden.mjs                                  # app.js vs the iOS golden vectors, <1s
cd ios/MidPntCore && swift test                       # the Swift port of the same logic, <10s
bash test/pg-up.sh && bash test/ios-interop.sh        # the Swift sync client against the real schema, <20s
```

`swift test` needs a Swift 6 toolchain (Linux is fine — `MidPntCore` imports no
Apple-only framework). `ios-interop.sh` puts a PostgREST stand-in (`test/rpc-shim.mjs`)
in front of the throwaway Postgres and runs the Swift client against it as the `anon` role.
`golden.mjs` also regenerates the iOS colour assets and `Config.swift` from `styles.css` and
`config.js`; it fails when `app.js`, `styles.css` or `config.js` has changed and
the committed copies are stale. Regenerate with `node test/golden.mjs --write`,
then make `MidPntCore` agree, and commit all of it together.

`CHROME_PATH` is only needed if Playwright's bundled browser is missing. In a
cloud container try `/opt/pw-browsers/chromium-*/chrome-linux/chrome`.

CI (`.github/workflows/tests.yml`) now runs all six on every push and PR. It
used to run only the two that need no browser or database, which is how a merge
nearly dropped fourteen counter assertions without anything going red.

`test/pg-up.sh` builds a throwaway Postgres on `/tmp:5433` and loads
`supabase/schema.sql`. Containers are ephemeral: if all 27 schema assertions
fail at once, the server is stopped, not the code broken. Re-run `pg-up.sh`.

**Never commit with a failing test.** Not "it's unrelated", not "I'll fix it
next". That habit is how three real bugs reached a user's phone here.

A test that cannot fail is not a test. When you fix a bug, re-introduce it and
confirm the new assertion goes red.

## Hard rules

- **Bump `?v=N` in `index.html` on every change to app.js, styles.css or
  sync.js.** GitHub Pages and iOS Safari both cache hard. Forgetting this means
  shipping to nobody. The footer reads the same number, so the running build is
  always visible on screen.
- **No raw colours outside a `:root` block.** Light mode is one block restating
  the palette; a hardcoded hex is invisible in one theme and glares in the
  other. `test/unit.mjs` fails the build on this.
- **Costs are indexed by `state.people`, with `null` for anyone who has not
  shared a location.** Scoring works on the located subset, so a local search
  must re-map before rendering. Two index bases is a bug that already shipped.
- **Never rename the `midpoint.*` localStorage keys, `MIDPOINT_CONFIG`, the
  repo, or the `/midpoint/` URL.** The brand is MidPnt; these are not the
  brand. `midpoint.session` backs `Sync.resume()` — rename it and refreshing
  mid-session creates a second copy of you, a bug already fixed once.
  `midpoint.groups` holds saved groups, `midpoint.name` the name people typed.
  Changing any of them silently wipes real data on every device.
- **Never add a LICENSE file.** The repo is deliberately all-rights-reserved.
  A licence cannot be revoked for commits already published.
- **Never commit a Supabase `service_role` key.** The publishable key in
  `config.js` is safe and public by design — the database denies it all direct
  table access, verified by 27 assertions. The secret key bypasses all of it.
- **A change to scoring, hours, chains, categories, link parsing or the search
  area lands in both `app.js` and `ios/MidPntCore` in the same commit**, with
  regenerated golden files. In a live session whichever phone taps Find decides
  the list for everyone; if the two scorers disagree, the ranking depends on who
  searched first. The scoring constants are literals in `Limits.swift` on
  purpose (a retuned `SPREAD_WEIGHT` must turn the Swift build red). Categories
  and `CHAIN_NAMES` are generated into `catalog.json` — never edit that by hand.
  The shared session format is written down in `docs/session-contract.md`.
- **The `?v=N` bump is web-only**; the app's equivalent is `CFBundleVersion`.
- **Error red is for things that are broken.** A person declining to share
  their location, or typing a place we cannot find, is not an error. Red for
  those reads as blame, and the first one landed on a tester's first screen.

## The API budget is the architecture

Everything is free and keyless, and the design follows from the limits:

| Service | Used for | Limit that shapes the code |
|---|---|---|
| Nominatim | geocode, reverse geocode | ~1 req/sec, **never per-venue** |
| Overpass | finding places | one call per search, all categories ORed |
| OSRM | travel times | one `/table` matrix per search, never per pair |

A search is **two HTTP calls total**, whatever the group size. If a change
would make it per-person or per-venue, it is the wrong change. This is why
venue towns come from OSM `addr:*` tags and are simply absent when untagged —
reverse geocoding each result would be one Nominatim call per venue, which
their usage policy forbids.

Live sessions poll every 4s (not Realtime — that needs table read access the
security model forbids), pause when the tab is hidden, and never stack
requests.

## Style

Comments explain **why**, not what, and often name the bug that caused the
line. If you remove a guard because it looks pointless, read its comment
first — most of them are headstones.

Prose in the UI leads with the fix, not the failure. "No match — try adding the
city" beats "Invalid location".

## Where things are

| | |
|---|---|
| `app.js` | everything client-side: scoring, map, rendering, categories |
| `sync.js` | Supabase client for live sessions (not a "sync folder") |
| `supabase/schema.sql` | full schema; `fix-*.sql` are migrations for live projects |
| `STATUS.md` | what works, what is next, what is already decided |
| `TODO.md` | things only Sal can do — accounts, signatures, decisions |
| `docs/` | brand, design system, OSM category reasoning |
| `handoff/` | who is working on what, and recent changes with their reasons |
| `ios/` | the iOS app: `MidPntCore` (Swift package, pure logic, builds on Linux) |
| `docs/ios-plan.md` | how the iOS app is built; `docs/session-contract.md` is the shared wire format |

`docs/osm-categories.md` explains why each category uses the tags it does.
Read it before adding or changing one — OSM tagging is full of traps, like
`amenity=cafe` being where mappers put pizzerias.

## Two people, two agents

- Branch for anything non-trivial; push to `main` only for small, tested work.
- **Claim what you are touching in `handoff/NOW.md` before you start**, and
  clear it when you stop. Two agents editing `app.js` at once is the one
  collision git will not help you with.
- Append to `handoff/LOG.md` when you finish something worth the other person
  knowing. Commit messages carry the detail; the log is the digest.
