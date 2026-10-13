# Log

Newest first. One entry per thing worth the other person knowing — not per
commit. The commit messages carry the reasoning at length; this is the digest
and the pointer.

Template:

```
## YYYY-MM-DD — short title
**Who** · `commit`
What changed, in a sentence or two. Why, if it is not obvious.
**Watch out:** anything that will bite the next person.
```

---

## 2026-10-13 — Renamed to MidPnt
**Sal / Claude** · this commit

Sal's call, and it was his preference from early on. "Midpoint" is crowded and
unownable, and it names the geographic middle — the thing every competitor
computes and the thing this app deliberately does not do. MidPnt is clear in
the App Store namespace. The known cost is spoken word of mouth: someone hears
"midpoint" and searches for it. Mitigation is owning both spellings and
titling the store listing "MidPnt — meet in the middle".

The mark is unchanged. Those two chevrons converging on empty space depict
meeting; they never spelled anything, so they work with any name.

**Watch out:** the rename was case-sensitive on purpose. Capital-M "Midpoint"
was the brand and became MidPnt. Lowercase "midpoint" is the geometric concept,
the repo name, the live URL and **six localStorage keys** — all deliberately
untouched. Renaming `midpoint.session` would break `Sync.resume()` and bring
back the duplicate-you-on-refresh bug; renaming `midpoint.groups` would delete
everyone's saved groups. Do not tidy them.

## 2026-09-30 — The app could wedge itself permanently
**Sal / Claude** · `d59b8d7`

`search()` set a `searching` flag before the guard for "nobody has a location
yet", and the `finally` that clears it was inside a later `try`. One search
with no locations left the flag true for the whole session and every later
search returned at its first line — the button looked alive and nothing ever
happened again. A joiner tapping Find before the first poll hit it exactly.

Also: costs came out of the scorer indexed by *located* people while cards draw
a row per person, so a joiner with no location shifted everyone's times down a
row and printed NaN. Both paths now index by `state.people` with `null` for
uncounted people, who get a dimmed "waiting" row.

**Watch out:** if you add an early `return` to `search()`, put it before
`state.searching = true` or the app wedges again. There is a test that hangs
the suite if you get this wrong.

## 2026-09-29 — Towns on venue cards, search box moved
**Sal / Claude** · `f171d10`

Cards read "Fair Grounds, Leominster". Town comes from OSM `addr:*` tags, shown
where known and absent where not — reverse geocoding each venue would be one
Nominatim call per result, which their policy forbids. The category search box
moved *below* the chips, where people actually look once none of the chips fit.

**Watch out:** `.vname` now contains a child `.vtown` span, so a test reading
`.vname` textContent gets the town too. Read the text node.

## 2026-09-29 — Breakfast returned a pizzeria
**Sal / Claude** · `8f459e5`

OSM's `amenity=cafe` is where mappers put anything counter-ish, pizzerias
included. Tag filters now support `!=` and `!~`, and Breakfast excludes
dinner cuisines plus five words in a venue name.

**Watch out:** name-based filtering is a blunt instrument — every word added is
a legitimate place it may silently drop. No other category uses one, and a test
enforces that.

## 2026-09-29 — Two live copies of the app
**Sal / Claude** · `8c8b77f`, `341fbe5`

Several rounds lost to a bug that was not a bug: Sal was looking at an old copy
of the app served from a folder in the portfolio repo. Added a build number to
the footer so "I don't see it" has a number for an answer. Also fixed a real
flex bug — `#sheet` had no `min-height:0`, so in WebKit the inner scroll never
engaged and everything past the fold was unreachable.

**Watch out:** Chromium forgives the missing `min-height:0`; WebKit does not,
and the tests scroll programmatically so they pass either way.

## 2026-09-27 — Light mode
**Sal / Claude** · `133b691` and before

Follows the phone's Appearance setting, with a three-state override in the
header. Every colour is a token; twenty contrast assertions, ten per theme.

**Watch out:** two light palette blocks exist — one for the media query, one
for the manual override. A test asserts they are identical. Change both.

## Rejected, so nobody re-proposes them

- **"Midpoint"** as the brand name, as of 13 October — see the rename entry
  above. The word is crowded (a fintech, two network companies, a conferencing
  firm, an iOS app developer, and an existing App Store listing) and describes
  the thing the product deliberately is *not*: the fair point, not the middle
  one.
- **Three branding directions** before the current one. The minimalist green
  mark and the quiet dark chrome are settled; see `docs/brand.md`.
- **A web wrapper for the App Store.** Guideline 4.2 rejects thin wrappers;
  passing it means building native anyway. See `ROADMAP-NATIVE.md`.
- **An in-app appearance override, in the native version.** iOS has had a
  system switch since iOS 13 and most of Apple's own apps ship no override.
  The web one exists only because there is no settings screen to put it in.
