# handoff

Two people work on Midpoint, each with their own Claude Code session. This
folder is what neither git nor a chat window can tell you.

Called `handoff` rather than `sync` because `sync.js` is already a thing — the
Supabase client for live sessions. Nothing here touches the app.

## The two files

**`NOW.md` — what is in flight.** Claim the files you are about to work on,
clear the claim when you stop. This is the one collision git will not save you
from: two agents editing `app.js` at the same time produce a conflict neither
of them can resolve sensibly, because both sides are half-finished.

**`LOG.md` — what changed and why.** Newest first. A digest, not a duplicate:
the commit messages here are long and carry the reasoning, so the log says what
happened and points at the commit rather than restating it.

## For the agent reading this

The house rules are in `CLAUDE.md` at the repo root, and Claude Code loads it
automatically — you have probably already read it.

At the **start** of a session:
1. Read `NOW.md`. If the other person has claimed what you were asked to
   change, say so and suggest something else rather than racing them.
2. Read the top few entries of `LOG.md` for what moved recently.
3. `git log --oneline -10` for the detail, if you need it.

At the **end** of a session, if anything shipped:
1. Add a `LOG.md` entry.
2. Clear your claims in `NOW.md`.

## Why not just read the commits?

Mostly you should — `git log` is the source of truth and the messages here
explain their reasoning at length. This folder exists for the two things git
genuinely cannot record:

- **What is happening right now**, in someone else's uncommitted working tree.
- **What was tried and rejected**, which leaves no commit behind. Three
  branding directions and a vowel-dropped product name were all abandoned, and
  without a note, the next person re-proposes them.

Keep it short. A status file nobody trusts is worse than no status file, and
the way they stop being trusted is by growing until nobody reads them.
