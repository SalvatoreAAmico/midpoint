# In flight

Claim before you start. Clear when you stop. If a claim is older than a few
days, assume it is stale and say so rather than working around it forever.

Format: `**Who** — files or area — what, and roughly until when.`

## Claimed

*(nothing right now)*

## Recently cleared

- **Sal / Claude** — `app.js`, `styles.css`, `test/smoke.mjs` — the "app gets
  hung up" report. Done, shipped in `d59b8d7`.

---

## Up for grabs

From `STATUS.md` and the last few sessions. Claim one here before starting so
the other person does not pick it up at the same time.

- **Decision log.** Roughly fifteen architectural decisions live only in commit
  messages — the 0.9 spread weight in the fairness score, polling instead of
  Realtime, why no web wrapper. Needs no review, just writing.
- **The live suite sleeps too much.** `test/smoke-live.mjs` burns ~145s on
  fixed `waitForTimeout` calls where it should wait on conditions. It will go
  flaky on a slow day, and that is how a suite stops being trusted.
- **Unknown opening hours rank too high.** When a day and time are set, a venue
  with no `opening_hours` in OSM can still come first. We never drop venues for
  missing data — that is right — but first place is a strong claim to make
  about a place we know nothing about.
- **Parking**, **transit times** (needs a self-hosted router), **recurring
  hangouts**.

## Known-but-unfixed

- `salvatoreaamico.com/meetup/` serves a copy of the app from 11 September,
  from a folder in the *portfolio* repo (`SalvatoreAAmico.github.io`), not this
  one. The deletion is written and sitting on an unmerged branch there. Until
  it is merged there are two live copies of Midpoint and it is very easy to
  test the wrong one. If something you just shipped is "not there", check the
  build number in the footer first.
