# Where things stand

One page, kept current, so picking this up after a gap costs a minute rather
than an hour. Newest first.

**Live at:** SalvatoreAAmico.com/midpoint/ · **Repo:** SalvatoreAAmico/midpoint

---

## Working today

Add up to 8 people by GPS or typed place. Pick activities from 38 categories,
or search them, or roll the dice. Ranked by real drive or walking time, fair
rather than merely central — a spot close for one person and far for another
loses. Chains hidden by default. Filter by a day and time, not just "open now".
Vote, veto, and get a declared winner. Save a group and load it next time.

**Live sessions** are confirmed working across two real devices: names typed on
one appear on the other, both directions.

**Live sessions** work: one link, everyone's pin and votes update in place,
no accounts, 12-hour expiry, database locked down so the public key can read
nothing without the session code.

**254 assertions** across four suites: unit, browser UI, live sessions against
a mocked Supabase, and the schema against a real Postgres.

## Waiting on Sal — about 10 minutes in total

- [ ] Run `supabase/fix-002-participant-label.sql` in the Supabase SQL editor.
      Without it other people see your pin but not where you are. The app works
      either way and says so when the update is missing.
- [ ] Put a real email address in `PRIVACY.md`, `TERMS.md`, `SECURITY.md`.
      They are unpublishable with the placeholder.
- [ ] Pick a licence. Recommendation: MIT. Currently all rights reserved by
      default, which means nobody may legally use or contribute.
- [ ] Use it for one real meetup. Still the only open question that matters,
      and the only one no amount of building answers.

## Next up, roughly in order

1. **Light mode.** Asked for once, never built; the most visible change left.
2. **Decision log.** Fifteen architectural decisions live only in commit
   messages.
3. **Flaky live test.** Real 4-second waits; should wait on conditions.
4. Parking near the chosen spot · transit times (needs a self-hosted router) ·
   recurring hangouts.

## Decided, so nobody relitigates it

| | | Why |
|---|---|---|
| Name, mark, green | Settled | Liked on sight |
| Interface | The original's quiet dark chrome | Preferred over three redesigns |
| Palette | Natural greens and blues | Asked for |
| Backend | Supabase, live sessions optional | Works without it |
| Platform | Web for now | See `ROADMAP-NATIVE.md` |
| Wrappers | Rejected | Guideline 4.2; passing it means building native anyway |

## Documents

`README.md` how it works · `TODO.md` what only Sal can do ·
`docs/brand.md` identity · `docs/design-system.md` interface ·
`docs/brand-brief.md` what has actually been decided, and the evidence ·
`docs/osm-categories.md` why those categories · `ROADMAP-NATIVE.md` the iOS case
