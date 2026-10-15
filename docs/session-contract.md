# The session contract

Live sessions are the one place two different clients — the web app and the iOS
app — write to the same state. `supabase/schema.sql` is the database; this is
what both clients promise each other on top of it. If you change anything here,
change `sync.js`, `ios/MidPntCore`, the schema tests and this file in the same
commit.

Written 2026-10-13 against build `?v=37`. The authority, where this document and
the code disagree, is `supabase/schema.sql` and `sync.js`; fix this file.

---

## Transport

Every call is `POST {supabaseUrl}/rest/v1/rpc/{function}` with a JSON object of
named arguments and these headers:

```
Content-Type: application/json
apikey: <publishable key from config.js>
Authorization: Bearer <same key>
```

The publishable key is public by design: the database denies it every direct
table access (`test/schema.sh` asserts it). **Never ship a `service_role` key in
either client.** Clients never read tables; they call functions, and
`mp_state` is the only read.

A `204` means success with no body. Anything else non-2xx carries
`{"message": "..."}`; clients match on substrings of it:

| `message` contains | Meaning | Shown as |
|---|---|---|
| `session_not_found` | Wrong code, or expired | "That session has expired or does not exist." |
| `session_full` | Already 8 people | "That session already has 8 people." |
| `results_too_large` | `mp_results` payload over 200,000 characters | write failure |
| `PGRST202`, `Could not find the function`, `does not exist` | The project predates a migration (see *Compatibility*) | per call, below |

Other messages are shown as they come.

## Identity

- A **session code** is 10 lowercase hex characters, created server-side.
  Clients lowercase and trim any code they are given before using it.
- A **participant id** is a UUID returned by `mp_create` / `mp_join`. It is the
  only credential for acting as that person: there is no account. Treat it as a
  secret of the device and persist it (web: `midpoint.session`; iOS: the same
  key in `UserDefaults`), or a relaunch joins again and fills the session with
  copies of one person.
- Sessions expire server-side 12 hours after creation. Clients also stop
  themselves after **2 hours** (`MAX_SESSION_MS`) and leave.

## Functions

All arguments are named; `p_participant` is the UUID string.

| Function | Arguments | Returns |
|---|---|---|
| `mp_create` | `p_name`, `p_label`, `p_lat`, `p_lon` | `{ code, participant_id }` |
| `mp_join` | `p_code`, `p_name`, `p_label`, `p_lat`, `p_lon` | `{ participant_id }` — or `session_full` |
| `mp_update` | `p_code`, `p_participant`, `p_name`, `p_label`, `p_lat`, `p_lon` | — |
| `mp_prefs` | `p_code`, `p_cats` (array), `p_filters` (object) | — |
| `mp_results` | `p_code`, `p_participant`, `p_results` (object) | — |
| `mp_vote` | `p_code`, `p_participant`, `p_venue`, `p_dir` (`-1`, `0`, `1`) | — |
| `mp_state` | `p_code` | the state object below |
| `mp_leave` | `p_code`, `p_participant` | — |
| `mp_tally` | `p_metric` (one word) | — |

`mp_tally` is the one call that takes **no session code**: a search by one
person with no live session still counts, so anything that gates these calls on
a code must let it past. It accepts a single word from a list fixed inside the
database, carries nothing else — no id, no code, no coordinates, no time finer
than the day — and silently ignores a word that is not on the list. The web
client calls it; **MidPntCore does not yet**, so the iOS app records nothing.

`mp_update` writes `lat`/`lon` verbatim, so `null` clears a location; `name` and
`label` keep their old value if `null` is passed. `mp_vote` with `p_dir = 0`
removes the vote.

## `mp_state`

```jsonc
{
  "code": "a1b2c3d4e5",
  "cats": ["coffee", "food"],          // category ids from the catalogue
  "filters": { ... },                  // see below; {} until someone sets one
  "expires_at": "2026-10-13T20:00:00+00:00",
  "results": { ... } | null,           // see below
  "results_by": "<uuid>" | null,       // who ran the search
  "results_at": "<timestamptz>" | null,
  "people": [                          // ordered by join time
    { "id": "<uuid>", "name": "Sal", "label": "Wicker Park, Chicago",
      "lat": 41.9088 | null, "lon": -87.6796 | null, "updated_at": "..." }
  ],
  "votes": [ { "participant_id": "<uuid>", "venue_key": "node/123", "dir": 1 } ]
}
```

A person with `lat`/`lon` of `null` is **in the session but has not shared a
location**. They are shown, they vote, and they have no travel time.

## `filters`

Everything that shapes a search travels with the session, so nobody ends up
looking at a different list. All keys optional; **unknown keys are ignored and
missing keys leave the local value alone** (`applyRemoteFilters`).

| Key | Type | Meaning |
|---|---|---|
| `travel` | `"drive"` \| `"walk"` | anything other than `"walk"` reads as `"drive"` |
| `when` | string | `""` any time, `"now"`, or `"0"`–`"6"` (Sunday = 0) |
| `whenTime` | `"HH:MM"` | used when `when` is a weekday |
| `noChains` | bool | hide chains |
| `maxPrice` | string | `""` or `"1"`–`"4"` |

A value of the wrong type is skipped, not an error.

## `results`

One search serves the session: whoever taps Find computes the list and shares
it; everyone else adopts it. **If two clients disagree about scoring, the
ranking depends on who searched first** — which is why `test/golden.mjs` exists.

```jsonc
{
  "at": 1760371200000,            // ms since epoch; adopt only if newer than what you hold
  "people": ["<uuid>", "<uuid>"], // the ids that were LOCATED when Find was tapped
  "together": false,              // everyone within 250 m: nearest-first, wider search
  "estimated": false,             // straight-line stand-ins: show every time with "~"
  "travel": "drive",
  "venues": [                     // at most 25, best first
    { "key": "node/123", "name": "...", "kind": "cafe", "town": "Chicago",
      "lat": 41.9, "lon": -87.7, "open": true | false | null,
      "hours": "Mo-Su 07:00-17:00", "price": 2 | null, "chain": false,
      "costs": [600, 840] }       // seconds, rounded, INDEXED BY `people` above
  ]
}
```

### The one rule that has already broken once

`costs[i]` belongs to `people[i]` **of the payload**, not to position `i` of
whoever is reading it. A reader re-indexes by id onto its own roster; anyone on
the roster who is not in `people` (they joined after the search) has *no time
yet*, and mean and spread are recomputed over the people who do. Two index bases
in one app made every row below a late joiner show somebody else's journey, and
the last row show `NaN`. In Swift this is made structurally impossible:
`ScoredVenue.costs` is `[personID: seconds]`, never an array.

Readers also drop any venue for which nobody on their roster has a time.

Tolerance, both ways: ignore fields you do not know; default fields you cannot
find (`together`/`estimated` → `false`, `town`/`hours` → `""`, `price`/`open` →
`null`). A payload whose `venues` is empty or missing is not adopted.

## Venue keys

`"<osm type>/<osm id>"`, e.g. `node/123`, `way/456`. They are the vote key and
the identity of a place across clients. Never derive them from the name.

## Votes

`dir` is `1` or `-1`; one vote per person per venue; `0` retracts. Tallies are
computed client-side from the `votes` array. A vote for a venue that is not in
the current results is kept, not rejected.

## Polling

Clients poll `mp_state` every **4 s**, because Realtime would need table read
access the security model forbids. The guards are part of the contract, since a
second client with a bug costs the same free-tier egress as the first:

- never faster than **2 s** (hard floor, whatever the interval is set to)
- **one request in flight**; never queue a backlog
- pause while the app is not in the foreground (web: tab hidden; iOS:
  `scenePhase != .active`), refresh once on return
- after a failure back off `4 s × 2^failures`, capped at 60 s; **5 consecutive
  failures** end the session locally and say so
- auto-leave after 2 hours

## Compatibility with older projects

A live Supabase project may predate a migration. Clients degrade rather than
fail:

- **`label`** (`fix-002`): if `mp_create` / `mp_join` / `mp_update` answer
  `PGRST202`, retry without `p_label`. Place names then do not travel.
- **`mp_results`** (`fix-003`): if it answers `PGRST202`, searches stay private
  to the searcher's device. Say that the migration is missing; do not report it
  as a connection problem.

## Invite links

`https://salvatoreaamico.com/midpoint/?s=<code>` joins a live session. With no
backend the whole group travels in the `#` hash instead — base64url of UTF-8
JSON, fields `p c tv w wt r v l n m` (`o` = the old open-now flag). Both must
keep working in both clients. `LinkState.parse` is held to `parseState` in
`app.js` by the golden vectors, including every default and every malformed
case.
