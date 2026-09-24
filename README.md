# Midpoint

Find a place to meet that's **fair to everyone**, not just central on a map.

Add up to 8 people, pick what you're in the mood for, and get ranked suggestions
with each person's real drive time shown side by side.

**Live:** https://SalvatoreAAmico.com/midpoint/

---

## What it does

1. **Manual mode** — type in neighborhoods/cities for up to 8 people, pick activity
   types, get ranked spots.
2. **Live-location mode** — each person taps *Locate*; their pin is added to the
   session. (See *How multi-user works* below — there's no server.)

**Independent only** is on by default. The midpoint chain coffee shop is a
technically correct and deeply uninspiring answer, so branded venues are hidden
unless you ask for them. Detection leans on OSM's `brand` / `brand:wikidata`
tags, which independents essentially never carry, with a name list as backup.
Where a midpoint has *nothing but* chains, they are shown anyway with a note —
an empty list reads as a broken search.

**🎲 Feeling lucky** picks three activity types at random and shuffles the
results, for when nobody can decide. It shuffles *within the twelve fairest*
spots rather than across everything: a random pick that is forty minutes from
one person would defeat the entire premise. Re-roll never repeats the same set.

**When** filters by opening hours at a chosen day and time, not just right now —
so you can plan Friday evening on a Tuesday.

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

## Live sessions (optional)

Tap **Go live** and the app puts you on the map first — filling in your name
(remembered from last time) and asking for your location — then creates a
session with a 10-character code. Seeing your own pin is the confirmation that
it worked, before anyone else joins. Tap the code to copy it, though the invite
link is the easier way to share since it joins people automatically.

Joining by link asks for location the same way going live does, so opening an
invite puts you on the map without hunting for a button. If the prompt is
dismissed, a **Share my location** button is there from the moment you join
rather than appearing only after the attempt gives up. Anyone
opening the link joins automatically; everyone's pin, name, and votes update in
place, roughly every 4 seconds. Capped at 4 people, enforced server-side.

Setup is in `supabase/schema.sql` — paste it into the Supabase SQL editor, then
put your project URL and client key into `config.js`. That key is the
**Publishable** key (`sb_publishable_…`) on projects created since late 2025, or
the legacy **anon public** key on older ones; both work, and neither is a secret.
The **Secret** / `service_role` key must never go here — it bypasses every
protection described below. Leave `config.js` blank and the app behaves exactly
as below, with no backend at all.

### Why the database is locked down the way it is

The browser carries a public client key, so anything that key can reach directly
is readable by anyone who views source. Sharing live coordinates that way would
let a stranger dump every session's locations with one query.

So the tables have row-level security enabled and **no policies whatsoever** —
the anon role cannot read or write them at all. Every operation goes through a
`security definer` function that demands the session's secret code, which makes
enumeration impossible: without a code you get nothing.

Two consequences worth knowing:

- **Updates poll instead of streaming.** Supabase Realtime needs table-level
  read access to push changes, which is exactly what this model forbids. A
  4-second poll trades a little latency for not exposing the tables. For four
  people picking a coffee shop, that's the right trade.
- **Sessions expire after 12 hours** and delete their participants with them.
  Location data shouldn't outlive the meetup it was shared for.

### Staying inside the free tier

The Free plan has no per-unit billing, so exceeding a limit throttles the
project rather than charging you — there is no card on file to charge. A
runaway client could still burn the month's egress and take the app down, so
the client caps itself:

| Guard | Effect |
|---|---|
| Interval floor (2s) | no bug can poll faster |
| Pause while tab hidden | a backgrounded phone costs nothing |
| One request in flight | slow networks can't queue a backlog |
| Backoff, stop after 5 failures | a broken server isn't hammered |
| Auto-leave after 2 hours | a forgotten tab can't poll all week |

For scale: four people for an hour is roughly **3.6 MB** against a **5 GB**
monthly allowance — about 1,400 hour-long meetups before it matters.

Anyone holding the link can see the group's locations for as long as the session
lives. That is the intended behaviour — but it is worth saying out loud, because
it means the link is as sensitive as the locations in it.

## How the no-backend mode works

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
OSRM `/table` call that returns all 8 people × 25 venues = 200 durations at once.
Requesting routes one pair at a time is what makes travel-time APIs expensive;
the matrix endpoint is what makes this free.

If OSRM is slow or down, the app falls back to straight-line estimates and marks
every figure with `~` rather than passing them off as measured times. This is a
fallback, not a setting — there is no reason a user would choose worse numbers.

### Known data limitations

- **Opening hours**: OSM's `opening_hours` coverage is partial, and the parser in
  `isOpenNow()` handles the common formats only. Anything it can't parse is shown
  as *Hours unknown* and is **never filtered out** — hiding those would hide most
  of the map.
- **Chain detection** is a heuristic. A franchise whose OSM entry lacks brand tags
  and isn't in the name list will slip through; a genuine independent that happens
  to carry a `brand` tag will be hidden. Shown chains are labelled, so a
  false negative is visible rather than silent.
- **Price**: OSM price tags are sparse. The filter only excludes venues that
  *have* a price tag exceeding your max. Untagged venues always pass. No guessing.
- **Transit times**: not supported. There is no free transit-routing API worth
  using; that needs a self-hosted OpenTripPlanner.

## Testing status

- Core geo/scoring/hours/chain/shuffle logic: **28/28 unit tests passing**.
- Full UI in headless mobile Chromium against mocked OSM responses:
  **48/48 passing**, no JS errors.
- Schema against a real Postgres as the `anon` role: **18/18 passing** —
  the full session flow, the cap, expiry, and the access restrictions above.
- Live-session flow against a mocked Supabase backend: **39/39 passing** —
  create, auto-join by link, roster sync, the 4-person cap, expired codes,
  vote propagation, leaving, and the four spend guards above.
- Live API calls: **verified on a real iPhone** (2026-09-13). Nominatim,
  Overpass, and OSRM all respond correctly from mobile Safari.

## Roadmap

**Phase 2 — real sync (Supabase free tier)** — *done, pending live verification*
Live sessions are implemented. Still open: accounts, and push when friends are
nearby (which needs native iOS).

**Phase 3 — native iOS** — see `ROADMAP-NATIVE.md` for the running list of
what a Swift app would and would not buy us.
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
config.js             Supabase URL + anon key (blank = no backend)
sync.js               live session client
supabase/schema.sql   database setup — run once in the SQL editor
styles.css            styling (dark, mobile-first, iOS safe-area aware)
app.js                all logic — geo, APIs, scoring, rendering
manifest.webmanifest  PWA manifest (Add to Home Screen)
icon.svg              app icon
```

No build step, no dependencies beyond Leaflet from a CDN.

Tests live in `test/` — see `test/README.md`. 15 unit + 27 browser assertions.
