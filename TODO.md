# Things only you can do

Tracked here because they need a decision, a signature, or an account that
isn't mine. Drafts exist where a draft is possible; a few of these are choices
rather than documents and are marked as such.

---

## Right now

- [ ] **Run `supabase/fix-002-participant-label.sql`** in the Supabase SQL
      editor. Without it, live sessions show everyone's pin but not where they
      are, and a person's own typed location looks lost on reload. Verified
      against a real Postgres from both a fresh install and the existing
      schema; sessions already running keep working.

## Before anyone else uses this

- [ ] **Read and approve `PRIVACY.md`** — draft written, accurate to what the
      code actually does. **Needs your review, and a lawyer's before the App
      Store.** Location is treated as sensitive personal information under
      CCPA and GDPR, and this is the item with real legal weight: people's
      live coordinates are already moving through the app.
- [ ] **Publish the privacy policy at a stable URL.** Apple requires one before
      an app can be listed. `SalvatoreAAmico.com/midpoint/privacy` would do.
- [ ] **Choose a licence.** A decision, not a draft. The repo is public with no
      licence, which means all rights reserved and nobody may legally use,
      fork or contribute. *Recommendation: MIT* if you want people to build on
      it. Adding one is easy; removing one later is effectively impossible.
      Tell me which and I'll add the file.

## Before the App Store

- [ ] **Read and approve `TERMS.md`** — draft written. **Needs review.** Apple
      requires either their standard EULA or your own terms.
- [ ] **A working support URL.** Apple checks it. An email address on a page is
      enough.
- [ ] **Privacy nutrition labels** in App Store Connect. Yours are unusually
      clean: no tracking, no accounts, no analytics, no third-party sharing for
      advertising. `PRIVACY.md` lists exactly what to declare.
- [ ] **Justify background location in the review notes** *(only if we build
      it)*. The most-rejected permission on the platform.
- [ ] **Apple Developer Program — $99/year.**

## Worth doing, no deadline

- [ ] **Decision log.** Roughly fifteen real architectural decisions currently
      live only in commit messages. I can draft it; no review needed.
- [ ] **`SECURITY.md`** — drafted. How to report a vulnerability privately.
      Doesn't need a lawyer.
- [ ] **Data deletion statement.** You are already in a strong position:
      sessions self-delete after twelve hours and there are no accounts to
      delete. Worth stating plainly somewhere public.

## Deliberately not doing yet

`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, anything called
governance. These matter when other people touch the code. Nobody does yet, and
documents nobody reads rot and then mislead.

---

## What I cannot do

- Give legal advice, or substitute for a lawyer reviewing the privacy policy
  and terms. I can only describe accurately what the code does.
- Choose your licence — it commits you to something.
- Anything requiring your Apple, GitHub or Supabase account.
