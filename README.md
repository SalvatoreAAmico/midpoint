# Midpoint

Find a place to meet that's **fair to everyone**, not just central on a map.

Add up to 4 people, pick what you're in the mood for, and get ranked suggestions
with each person's real drive time shown side by side.

**Live:** https://SalvatoreAAmico.com/midpoint/

---

## What it does

1. **Manual mode** — type in neighborhoods/cities for up to 4 people, pick activity
   types, get ranked spots.
2. **Live-location mode** — each person taps *Locate*; their pin is added to the
   session. (See *How multi-user works* below — there's no server.)

Every suggestion shows a **fairness breakdown**: a bar per person with their
individual travel time, so the group can see at a glance if one person is eating
the whole trip.

## Scoring

```
score = mean(travel time) + 0.9 × (max travel time − min travel time)
```

Lower wins. The mean term keeps the spot central; the **spread penalty** is what
makes it fair — it demotes a venue that's 5 minutes from one person and 40 from
another, even though its average looks fine. Tune `SPREAD_WEIGHT` in `app.js`
to trade "convenient for most" against "equal for all".

## How multi-user works without a server

The entire session — people, coordinates, activity choices, and votes — is
base64-encoded into the **URL hash**. Share the link, your friend opens it, taps
*Locate*, and their pin joins the session. They copy the link back to return
their votes.

That's the whole trick. No database, no accounts, no hosting bill, and nothing
to breach. The tradeoff is that syncing is manual — see the roadmap.

## APIs and cost

| Purpose | Service | Key? | Cost |
|---|---|---|---|
| Map tiles | OpenStreetMap | no | **$0** |
| Geocoding | Nominatim | no | **$0** (1 req/sec, cached in-memory) |
| Place search | Overpass API | no | **$0** (falls back to a mirror) |
| Drive times | OSRM demo server | no | **$0** |
| Hosting | GitHub Pages | no | **$0** |

**Total: $0/month.**

A full search costs exactly **two HTTP requests**: one Overpass query, and one
OSRM `/table` call that returns all 4 people × 25 venues = 100 durations at once.
Requesting routes one pair at a time is what makes travel-time APIs expensive;
the matrix endpoint is what makes this free.

If OSRM is slow or down, the app degrades to straight-line estimates and labels
them with a `~` rather than passing them off as measured times.

### Known data limitations

- **Opening hours**: OSM's `opening_hours` coverage is partial, and the parser in
  `isOpenNow()` handles the common formats only. Anything it can't parse is shown
  as *Hours unknown* and is **never filtered out** — hiding those would hide most
  of the map.
- **Price**: OSM price tags are sparse. The filter only excludes venues that
  *have* a price tag exceeding your max. Untagged venues always pass. No guessing.
- **Transit times**: not supported. There is no free transit-routing API worth
  using; that needs a self-hosted OpenTripPlanner.

## Testing status

- Core geo/scoring/hours logic: **15/15 unit tests passing**.
- Full UI in headless mobile Chromium against mocked OSM responses:
  **27/27 passing**, no JS errors.
- Live API calls: **not yet verified end-to-end** — the dev sandbox blocks
  outbound requests to these hosts. First real browser run is the acceptance test.

## Roadmap

**Phase 2 — real sync (Supabase free tier)**
Accounts, live presence, and push when friends are nearby. This is the point where
the app stops being a calculator and starts being social.

**Phase 3 — native iOS**
- Business logic (scoring, tag mapping, API calls) ports ~1:1 — roughly 25–30% of the code.
- UI is a rewrite: HTML/CSS → SwiftUI, Leaflet → MapKit, Geolocation → CoreLocation.
- Requires a Mac, Xcode, and the $99/yr Apple Developer Program.
- Background location ("ping me when two friends are nearby") is **only** possible
  natively — iOS PWAs get location solely while open in Safari. Expect extra App
  Store review scrutiny for that permission.

**Other ideas worth considering**
- Recurring groups ("the Tuesday crew") so you don't re-enter people every time.
- Calendar integration to propose a time as well as a place.
- "Veto" lists — never suggest a place someone already rejected.
- Weather-aware filtering (drop outdoor parks when it's raining).
- Split-the-difference for *repeat* meetups: track who traveled farthest last time
  and bias the next pick toward them.

## Files

```
index.html            app shell
styles.css            styling (dark, mobile-first, iOS safe-area aware)
app.js                all logic — geo, APIs, scoring, rendering
manifest.webmanifest  PWA manifest (Add to Home Screen)
icon.svg              app icon
```

No build step, no dependencies beyond Leaflet from a CDN.

Tests live in `test/` — see `test/README.md`. 15 unit + 27 browser assertions.
