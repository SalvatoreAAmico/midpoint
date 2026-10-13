# ios/

The native app. `docs/ios-plan.md` is the plan; this is where it stands.

Built in a Linux container with no Xcode. That split is deliberate and shows up in
what is verified:

| Layer | What it is | How it is checked |
|---|---|---|
| `MidPntCore/` | All the logic: scoring, hours, chains, categories, search, sync, polling, voting, the whole `AppModel` | `swift test` (93 tests), golden vectors against `app.js`, and `test/ios-interop.sh` against the real schema |
| `MidPnt/` | SwiftUI, MapKit, CoreLocation, ActivityKit, WidgetKit: a thin shell that binds to `AppModel` | Syntax-parsed only. **Never compiled.** `.github/workflows/tests.yml` job `ios-app` is its first compile |

Everything that could be a decision lives in the first row so that it is tested on
Linux; the second row only draws it.

## Phase status

| Phase | State |
|---|---|
| 1. `MidPntCore` | Done. |
| 2. Parity, solo | Written, **not compiled or run**. People, locate, categories, search, map, ranked cards with per-person bars, together/outlier/volunteer logic, lucky, when/price/chains/walk-drive, open in Maps, saved groups, brand tokens, fonts, privacy manifest. |
| 3. Live sessions | Core done and tested, including a mixed two-phone session and the real schema. Universal Link handling and the share sheet are written, not run. **Not done:** the "two real devices" test, which needs devices. |
| 4. The reasons we went native | Live Activity and Home Screen widget written, not run. **Not built, on purpose:** push notifications (first server code, first new stored data: its own review, per the plan) and background location (last, after approval, with usage data). |
| 5. App Store | Nothing to build. Everything left is Sal's: see `TODO.md` and `docs/ios-plan.md` §9. |

## First time on a Mac

```
brew install xcodegen
cd ios/MidPnt && xcodegen generate && open MidPnt.xcodeproj
```
The project file is generated (`project.yml`), not checked in. Expect compile errors in
`MidPnt/`: it has not met a compiler. The UI targets build in Swift 5 language mode for
that reason; raise `SWIFT_VERSION` once it is clean. Before anything ships, `project.yml`
needs `DEVELOPMENT_TEAM`, `MP_SUPPORT_EMAIL`, `MP_PRIVACY_URL`, `MP_TERMS_URL`.

Fonts are variable TTFs (Fraunces, JetBrains Mono, both OFL, licences alongside). If a
face does not render, check the family name `Font.custom` resolves to in Font Book first;
the UI falls back to the system font silently.

## Generated, so never edit

`node test/golden.mjs --write` produces, from the web app's own files:

- `MidPntCore/Tests/golden/*.json` and `MidPntCore/Sources/.../Resources/catalog.json`: from `app.js`
- `MidPnt/Resources/Assets.xcassets/*.colorset` and `MidPnt/Generated/Palette.swift`: from the `:root` blocks of `styles.css`, plus the eight route colours from `app.js`
- `MidPnt/Generated/Config.swift`: from `config.js`

"No raw colours outside a `:root` block" becomes "no `Color(red:…)` outside the asset catalogue".

## MidPntCore

```
cd ios/MidPntCore && swift test
```

| Port of | File |
|---|---|
| `haversine`, `centroid`, `findOutliers` | `Geo.swift` |
| `isOpenNow`, `priceLevel`, `fmtMin` | `Hours.swift` |
| `isChain` | `Chains.swift` |
| `CATALOG`, `searchCats` | `Catalog.swift`, `Resources/catalog.json` (generated) |
| `tagFilter`, `overpassQuery` | `Overpass.swift` |
| `parseVenues`, `filterVenues`, `searchArea` | `Venues.swift` |
| `scoreVenues`, `remapResults` | `Scoring.swift` |
| `parseState` (invite links), `?s=` | `LinkState.swift`, `JSONValue.swift`, `Invite.swift` |
| `tally`, `winner`, `vote`, `rollLucky`, `mapsUrl` | `Votes.swift` |
| `codename`, `placeName`, `suggestGroupName`, `shuffle` | `Names.swift` |
| saved groups, `midpoint.*` keys | `Groups.swift`, `Storage.swift` |
| tuning constants | `Limits.swift` |
| `sync.js` | `Sync/SessionClient.swift`, `Sync/SessionPoller.swift`, `Sync/SessionState.swift` |
| geocode / Overpass / OSRM, `search()` | `Services/` (behind an injectable `HTTPTransport`) |
| the screens' state | `AppModel.swift` |

### Differences from the web app, deliberately

- Costs are `[personID: seconds]`, not arrays. Two index bases cannot exist.
- Sorting is explicitly stable (ties keep input order); JS gives that for free.
- Tuning constants are literals in `Limits.swift`, pinned to `app.js` by `LimitsTests`, so
  retuning one turns this build red. Categories and the chain list are generated instead.
- One state object (`AppModel`) per screen group, not one global.
- The Nominatim `User-Agent` is mandatory and the 1 req/sec floor is enforced by an actor.
- No `MKDirections` anywhere: it is per pair, the shape the API budget forbids.

### Bugs the tests found while this was written

- `codename()` hashes only the high surrogate of an emoji (`charCodeAt(0)` on a code point).
- The poller treated a never-started session as two hours old.
- A "one request in flight" test that passed with the guard removed, because the fake server
  answered instantly. It now has latency.

## Needs Sal

Nothing here can be done from a container; each is a line in `TODO.md` or plan §9:
Apple Developer account and Team ID · bundle ID (permanent) · the AASA file on
salvatoreaamico.com (template: `docs/apple-app-site-association.json`) · a support email ·
stable privacy/terms URLs · App Store listing, nutrition labels · whether push is in v1.
