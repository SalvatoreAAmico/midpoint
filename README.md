# Midpoint

*Picking this up after a gap? Read `STATUS.md` first.*

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

**Search** sits above the chips and covers 37 categories — cuisines included,
so "pizza", "sushi" and "tacos" narrow to `cuisine=*` rather than returning
every restaurant. It matches on what people type rather than on tag names, and
long-tail wants resolve *upward*: "axe throwing" offers bars instead of
offering nothing. Only categories dense enough in OSM to return results are
listed. See `docs/osm-categories.md`.

**Everyone in one place** is handled rather than degenerating. Two phones on a
sofa, or a group already together deciding where to go next: there is no
fairness question left, so the search widens (the constraint becomes what is
worth walking out to, not who travels) and the per-person bars collapse into a
single line, because eight identical bars say nothing.

**Names default to a placeholder** like *Punctual Otter* rather than "Me",
derived deterministically from the participant id so every device shows the
same name for the same person with no coordination. If two devices belonging to
one person both recall the same saved name, whoever did not type it this
session gives way to a placeholder.

**Saved groups** keep the people you meet most often. Save the current set
under a name, tap it next time, and everyone is back with their places already
filled in. Stored on the device: no account, no backend, nothing to sign up
for. This is the feature that gives the app a reason to be reopened, which
nothing else in it did.

**🎲 Feeling lucky** picks three activity types at random and shuffles the
results, for when nobody can decide. It shuffles *within the twelve fairest*
spots rather than across everything: a random pick that is forty minutes from
one person would defeat the entire premise. Re-roll never repeats the same set.

**When** filters by opening hours at a chosen day and time, not just right now —
so you can plan Friday evening on a Tuesday.

**Driving or walking** changes the routing profile, the search radius (nobody
walks 20 km) and the fallback speed. If the walking profile is unavailable the
app estimates from distance and marks every figure `~`.

**One person far from everyone else** is detected and named rather than quietly
absorbed. Meeting "in the middle" of a lopsided group is equal but absurd — in a
worked example, seven people each travel an hour further to save one person an
hour. So the app offers both readings: keep it equal, or let the distant person
take the longer trip. Anyone can also volunteer at any time with **I can travel
further**, which drops them out of the fairness spread and reduces their weight
in the average.

In a live session **one search serves everybody**. A search already computes
travel times for every person in the session, so the result belongs to the
group rather than to whoever tapped the button: it is published to the session,
every phone shows the same list in the same order, and the group makes half as
many calls to the free services. Anything anyone gives a thumbs-up rises into a
**shortlist** pinned to the top of every phone, so voting narrows the choice
instead of only moving a tally.

Every suggestion shows a **fairness breakdown**: a bar per person with their
individual travel time, so the group can see at a glance if one person is eating
the whole trip.

## Scoring

```
score = weighted mean(travel time) + 0.9 × (spread across non-volunteers)
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

- Core geo/scoring/hours/chain/shuffle/search/outlier logic: **59/59 unit tests passing**.
- Full UI in headless mobile Chromium against mocked OSM responses:
  **67/67 passing**, no JS errors, including the blocked-location recovery path.
- Schema against a real Postgres as the `anon` role: **18/18 passing** —
  the full session flow, the cap, expiry, and the access restrictions above.
- Live-session flow against a mocked Supabase backend: **43/43 passing** —
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

## Brand and design

| Document | Answers |
|---|---|
| `docs/brand.md` | Who we are: mark, colour meaning, voice, naming, misuse. |
| `docs/design-system.md` | How the interface is built: tokens, components, layout. |
| `docs/osm-categories.md` | Which activity categories exist, and why those. |

The visual language is documented in `docs/design-system.md` and is normative:
if the app and that document disagree, the app is wrong. In short — a wayfinding
instrument, not a social app: warm neutrals rather than the cold blue-grey of
generated interfaces, Fraunces for the two or three display moments, Archivo for
everything functional, JetBrains Mono for every number, one accent that means
"the decision", and eight route colours for the people. Emoji mark categories,
which is content, and appear nowhere in the interface chrome.

## Files

```
index.html            app shell
config.js             Supabase URL + anon key (blank = no backend)
sync.js               live session client
supabase/schema.sql   database setup — run once in the SQL editor
styles.css            the design system, as tokens and components
docs/design-system.md the normative reference for the interface
docs/brand.md         identity: mark, voice, colour meaning, naming
assets/mark.svg       the logo mark
app.js                all logic — geo, APIs, scoring, rendering
manifest.webmanifest  PWA manifest (Add to Home Screen)
icon.svg              app icon
```

No build step, no dependencies beyond Leaflet from a CDN.

Tests live in `test/` — see `test/README.md`. 15 unit + 27 browser assertions.
