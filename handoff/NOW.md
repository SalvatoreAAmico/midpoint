# In flight

Claim before you start. Clear when you stop. If a claim is older than a few
days, assume it is stale and say so rather than working around it forever.

Format: `**Who** — files or area — what, and roughly until when.`

## Claimed

*(nothing right now)*

## Recently cleared

- **Claude** — `ios/`, `test/golden.mjs`, `docs/session-contract.md`, and a
  behaviour-preserving extraction in `app.js` — iOS phase 1. Done, 13 October.
- **Claude** — `ios/`, `test/rpc-shim.mjs`, `test/ios-interop.sh`, votes extraction in `app.js` (`?v=38`) — iOS phases 2–4 as far as a Linux container can verify. Done, 13 October.

- **Sal / Claude** — `app.js`, `styles.css`, `test/smoke.mjs` — the "app gets
  hung up" report. Done, shipped in `d59b8d7`.

---

## Up for grabs

From `STATUS.md` and the last few sessions. Claim one here before starting so
the other person does not pick it up at the same time.

- **iOS: first compile on a Mac.** `ios/MidPnt` (SwiftUI, widgets, Live Activity) was written
  without Xcode and has only been syntax-parsed. Run `xcodegen generate`, fix what the compiler
  finds, then the two-real-devices test. See `ios/README.md`. Also still open: push notifications
  (own review) and background location (after approval).
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

- **iOS does not count.** `mp_tally` is in the session contract and the web
  client calls it, but `ios/MidPntCore/Sync/SessionClient.swift` has no
  equivalent, so nothing an iPhone does reaches `public.stats`. Small job: one
  method plus the call sites that mirror `countEvent` in `app.js`.

## Known-but-unfixed

- **`supabase/fix-004-counters.sql` has not been run on the live project.**
  Until Sal runs it in the Supabase SQL editor, every counter call fails
  silently — which is by design, counting must never break a search, but it
  also means nothing is being recorded yet.

## Recently killed

- **The /meetup ghost.** A copy of the app from 11 September lived in a folder
  in the *portfolio* repo and was served at `salvatoreaamico.com/meetup/`
  alongside the real thing. Deleted 13 October. It cost several rounds of
  debugging: a missing control was reported, the current repo was measured, and
  the report was wrongly dismissed. The habit it leaves behind is a good one —
  **if something you just shipped is "not there", check the build number in the
  footer before you check the code.**
