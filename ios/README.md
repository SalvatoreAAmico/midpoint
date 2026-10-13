# ios/

The native app. Read `docs/ios-plan.md` first; this is where it stands.

## MidPntCore — done (phase 1)

A Swift package with no UIKit, SwiftUI, MapKit or CoreLocation, so it builds and
tests on Linux:

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
| `parseState` (invite links) | `LinkState.swift`, `JSONValue.swift` |
| `codename`, `placeName`, `suggestGroupName`, `shuffle` | `Names.swift` |
| saved groups | `Groups.swift` |
| tuning constants | `Limits.swift` |
| geocode / Overpass / OSRM | `Services/` (behind an injectable `HTTPTransport`) |
| `search()` | `Services/Search.swift` |

`Tests/golden/*.json` and `Resources/catalog.json` are **generated** from
`app.js` by `node test/golden.mjs --write`. Do not edit them.

### Differences from the web app, deliberately

- Costs are `[personID: seconds]`, not arrays. Two index bases cannot exist.
- Sorting is explicitly stable (ties keep input order); JS gives that for free.
- Tuning constants are literals in `Limits.swift`, pinned to `app.js` by
  `LimitsTests`, so retuning one turns this build red.
- `Search.run` takes plain `Traveller`s; `CLLocation` stays in the app target.

### Not here yet

- **`Sync`** (the `mp_*` RPC client and poller) is phase 3. `docs/session-contract.md`
  is the spec; `SharedResults` already decodes and re-indexes the `results`
  payload.
- Nominatim needs a real contact address in its `User-Agent`
  (`MidPnt-iOS/<version> (<support email>)`). The package takes it as a
  parameter; **the address is Sal's to choose**.

## The app (phase 2+)

Not started, and not to be until a real meetup has happened — see
`docs/ios-plan.md` §0. It needs a Mac.
