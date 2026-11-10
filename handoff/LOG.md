# Log

Newest first. One entry per thing worth the other person knowing — not per
commit. The commit messages carry the reasoning at length; this is the digest
and the pointer.

Template:

```
## YYYY-MM-DD — short title
**Who** · `commit`
What changed, in a sentence or two. Why, if it is not obvious.
**Watch out:** anything that will bite the next person.
```

---

## 2026-10-13 — Aggregate counters, no third-party anything
**Sal / Claude** · this commit

We had no idea whether anyone had ever used this. Seven counters now answer the
only questions that matter: does a search finish, does a group of more than one
form, does anyone reach a decision, does anyone save a group.

Deliberately NOT third-party analytics. The product's data is live location,
and the growth loop is a friend tapping a link — an App Store label reading
"Location, used to track you" would tax the one thing that makes this spread,
for an app opened ninety seconds at a time with almost no ad inventory. That
decision is a business one before it is an ethical one.

The counters carry a single whitelisted word and nothing else: no id, no code,
no coordinates, no device, no IP, no time finer than the day. The whitelist is
enforced in the database, so the client cannot invent a metric name and
free-text its way into storing something personal. The table is bounded by days
x metrics, so spam inflates numbers but never the table. `anon` can count and
cannot read; read them in the Supabase SQL editor:
`select day, metric, n from public.stats order by day desc, metric;`

**Watch out:** `mp_tally` takes no session code on purpose, so solo searches
count. Anything that gates RPCs on a session code must let it past — the mock
in smoke-live.mjs got this wrong first time and every counter 400'd. Also
`countEvent()` is the app-side helper, NOT `tally()`, which is the vote counter;
declaring both is a syntax error.

Needs `supabase/fix-004-counters.sql` run on the live project before any of it
records anything.

## 2026-10-13 — iOS phases 2–4: sync, app model, SwiftUI shell, widgets
**Claude** · this commit

`MidPntCore` now holds the whole app's logic: `SessionClient` / `SessionPoller` (every
spend guard from `sync.js`), voting and winner, lucky, maps links, invite parsing, and
`AppModel`. 93 tests, including two phones in one session agreeing on roster, order,
shortlist and winner, and `test/ios-interop.sh`, which runs the Swift client against the
**real schema** as `anon` through `test/rpc-shim.mjs` (a PostgREST stand-in). `app.js`
gained `tallyOf` / `pickWinner` (pure; `?v=38`). `test/golden.mjs` also generates the iOS
colour assets, `Palette.swift` and `Config.swift`, so palette and endpoint cannot drift.

`ios/MidPnt/` is the SwiftUI shell, a Home Screen widget and a Live Activity. **It has never
been compiled** (no Xcode in a container); only syntax-parsed. The CI job `ios-app` is its
first compile. Push notifications and background location were left unbuilt on purpose.

**Watch out:** the plan's "two real devices" test is still owed. See `ios/README.md`.

## 2026-10-13 — iOS phase 1: MidPntCore and the golden vectors
**Claude** · this commit

`ios/MidPntCore`, a Swift package with no Apple-only imports (tests on Linux):
distance, centroid, outliers, scoring, opening hours, chains, categories,
Overpass query and parsing, link parsing, codenames, saved groups, plus thin
Nominatim / Overpass / OSRM clients and `Search.run`, whose test asserts a
search is two HTTP calls at group sizes 1, 2, 4 and 8. `test/golden.mjs` runs
`app.js` over fixed inputs and writes the answers to `ios/MidPntCore/Tests/golden/`;
`swift test` reproduces them. `docs/session-contract.md` writes down the `mp_*`
wire format. CI runs unit, golden and `swift test` (`.github/workflows/tests.yml`).

`app.js` changed, behaviour-preservingly: `parseState`, `parseVenues`,
`searchArea`, `filterVenues` and `remapResults` were extracted from
`decodeState`, `fetchVenues`, `search` and `adoptResults` so there is something
pure to compare against. `?v=37`.

**Watch out:** `SPREAD_WEIGHT` and the other tuning constants are literals in
`Limits.swift` on purpose. Retune one in `app.js` and `swift test` goes red until
Swift is retuned in the same commit; categories and the chain list are generated
and need no Swift change. The golden vectors caught one real disagreement while
this was written: `codename()` hashes the *high surrogate only* of an emoji
(`charCodeAt(0)` on a code point), not both UTF-16 units.

## 2026-10-13 — A build plan for the iOS app
**Sal / Claude** · this commit

`docs/ios-plan.md`: Swift package `MidPntCore` for the pure logic (builds and
tests on Linux, so no Mac until the UI), SwiftUI + MapKit app on top, same
Supabase backend untouched. The scorers are kept honest by golden vectors
generated from `app.js`, so a ranking never depends on which phone searched.
Phase 1 can start now; the SwiftUI shell waits for one real meetup.

**Watch out:** nothing is built yet. Section 9 lists the decisions only Sal
can make (Mac, developer account, bundle ID, Universal Links file on the
portfolio site).

## 2026-10-13 — Renamed to MidPnt
**Sal / Claude** · this commit

Sal's call, and it was his preference from early on. "Midpoint" is crowded and
unownable, and it names the geographic middle — the thing every competitor
computes and the thing this app deliberately does not do. MidPnt is clear in
the App Store namespace. The known cost is spoken word of mouth: someone hears
"midpoint" and searches for it. Mitigation is owning both spellings and
titling the store listing "MidPnt — meet in the middle".

The mark is unchanged. Those two chevrons converging on empty space depict
meeting; they never spelled anything, so they work with any name.

**Watch out:** the rename was case-sensitive on purpose. Capital-M "Midpoint"
was the brand and became MidPnt. Lowercase "midpoint" is the geometric concept,
the repo name, the live URL and **six localStorage keys** — all deliberately
untouched. Renaming `midpoint.session` would break `Sync.resume()` and bring
back the duplicate-you-on-refresh bug; renaming `midpoint.groups` would delete
everyone's saved groups. Do not tidy them.

## 2026-09-30 — The app could wedge itself permanently
**Sal / Claude** · `d59b8d7`

`search()` set a `searching` flag before the guard for "nobody has a location
yet", and the `finally` that clears it was inside a later `try`. One search
with no locations left the flag true for the whole session and every later
search returned at its first line — the button looked alive and nothing ever
happened again. A joiner tapping Find before the first poll hit it exactly.

Also: costs came out of the scorer indexed by *located* people while cards draw
a row per person, so a joiner with no location shifted everyone's times down a
row and printed NaN. Both paths now index by `state.people` with `null` for
uncounted people, who get a dimmed "waiting" row.

**Watch out:** if you add an early `return` to `search()`, put it before
`state.searching = true` or the app wedges again. There is a test that hangs
the suite if you get this wrong.

## 2026-09-29 — Towns on venue cards, search box moved
**Sal / Claude** · `f171d10`

Cards read "Fair Grounds, Leominster". Town comes from OSM `addr:*` tags, shown
where known and absent where not — reverse geocoding each venue would be one
Nominatim call per result, which their policy forbids. The category search box
moved *below* the chips, where people actually look once none of the chips fit.

**Watch out:** `.vname` now contains a child `.vtown` span, so a test reading
`.vname` textContent gets the town too. Read the text node.

## 2026-09-29 — Breakfast returned a pizzeria
**Sal / Claude** · `8f459e5`

OSM's `amenity=cafe` is where mappers put anything counter-ish, pizzerias
included. Tag filters now support `!=` and `!~`, and Breakfast excludes
dinner cuisines plus five words in a venue name.

**Watch out:** name-based filtering is a blunt instrument — every word added is
a legitimate place it may silently drop. No other category uses one, and a test
enforces that.

## 2026-09-29 — Two live copies of the app
**Sal / Claude** · `8c8b77f`, `341fbe5`

Several rounds lost to a bug that was not a bug: Sal was looking at an old copy
of the app served from a folder in the portfolio repo. Added a build number to
the footer so "I don't see it" has a number for an answer. Also fixed a real
flex bug — `#sheet` had no `min-height:0`, so in WebKit the inner scroll never
engaged and everything past the fold was unreachable.

**Watch out:** Chromium forgives the missing `min-height:0`; WebKit does not,
and the tests scroll programmatically so they pass either way.

## 2026-09-27 — Light mode
**Sal / Claude** · `133b691` and before

Follows the phone's Appearance setting, with a three-state override in the
header. Every colour is a token; twenty contrast assertions, ten per theme.

**Watch out:** two light palette blocks exist — one for the media query, one
for the manual override. A test asserts they are identical. Change both.

## Rejected, so nobody re-proposes them

- **"Midpoint"** as the brand name, as of 13 October — see the rename entry
  above. The word is crowded (a fintech, two network companies, a conferencing
  firm, an iOS app developer, and an existing App Store listing) and describes
  the thing the product deliberately is *not*: the fair point, not the middle
  one.
- **Three branding directions** before the current one. The minimalist green
  mark and the quiet dark chrome are settled; see `docs/brand.md`.
- **A web wrapper for the App Store.** Guideline 4.2 rejects thin wrappers;
  passing it means building native anyway. See `ROADMAP-NATIVE.md`.
- **An in-app appearance override, in the native version.** iOS has had a
  system switch since iOS 13 and most of Apple's own apps ship no override.
  The web one exists only because there is no settings screen to put it in.
