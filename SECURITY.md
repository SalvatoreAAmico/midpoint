# Reporting a security problem

Please report privately rather than opening a public issue, so it can be fixed
before it is widely known.

**Email: [ADD A REAL EMAIL ADDRESS]**

Useful to include: what you found, how to reproduce it, and what an attacker
could do with it. You will get an acknowledgement, and credit if you want it.

## Worth knowing before you look

The security model is documented in `supabase/schema.sql` and in the README.
In short: the browser holds a public key, so the database gives that key **no
direct table access at all** — row-level security is enabled with no policies —
and every operation goes through a function that requires the session's secret
code. Sessions expire after twelve hours.

`test/schema.sh` runs the schema against a real Postgres as the anonymous role
and asserts, among other things, that it cannot read any table directly. If you
find a way around that, it is a genuine finding and worth reporting.

## Known and accepted

- **Anyone holding a session link can see that session's locations.** This is
  the intended behaviour — it is how the app works — and it is stated in the
  privacy policy and the terms. Session codes are 40 bits of randomness, which
  makes guessing them in bulk impractical, but a leaked link is a leaked link.
- **Travel times require sending coordinates to a third-party router.** Also
  intended, also disclosed. No free alternative computes them on-device.
