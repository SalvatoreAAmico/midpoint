# Midpoint — Brand Guidelines

The identity: what Midpoint is, what it sounds like, and how it appears
anywhere — in the product, on a store listing, in a screenshot someone sends a
friend.

**How this relates to the other documents**

| Document | Answers |
|---|---|
| `docs/brand.md` (this) | Who we are. Mark, colour meaning, voice, naming, misuse. |
| `docs/design-system.md` | How the interface is built. Tokens, components, layout. |
| `docs/osm-categories.md` | Which categories exist and why. |

The split follows a convention common to published design systems: brand governs
identity, the design system governs implementation. The direct influences on
this one are the NYCTA Graphics Standards Manual (Vignelli/Unimark, 1970) for
the wayfinding language and the plate structure, Mailchimp's content style
guide for the tone-by-situation matrix, and GOV.UK's service manual for plain
language and error messages that lead with the fix. Where they overlap
— colour, type — **this document defines meaning and the design system defines
values.** Changing a hex belongs there; changing what a colour is *for* belongs
here.

---

## 1. What Midpoint is

**Midpoint finds a place to meet that is fair to everyone.**

Not the geographic middle — the *fair* middle. A café five minutes from you and
forty from your friend has a perfectly reasonable average and is the wrong
answer. That distinction is the entire product, and everything in this document
exists to keep it legible.

**Positioning.** A wayfinding instrument, not a social network. It is opened for
ninety seconds by a group who need to decide, and then closed. It has no feed,
no profile, no followers, and will not acquire them.

**The promise.** *Nobody always drives.*

**What it is not.** Not a discovery app — it does not want to teach you about
your city. Not a review site — it holds no opinion about whether a place is
good. Not an events platform. It answers one question and gets out of the way.

## 2. Brand principles

Distinct from the interface tenets in the design system: these govern
judgement, not layout.

**1. Fairness is the product, not a feature.**
Every surface shows who travels how far. We never hide the cost of a
suggestion, even when hiding it would make the answer look tidier.

**2. Show the working.**
When the app decides something, it says why. "Shuffled from the 12 fairest."
"2 chains hidden." "Mike is far from everyone else." A recommendation without a
reason is a demand.

**3. Say what is true, including when it is unflattering.**
Hours are shown as *unknown* rather than guessed. Estimated times are marked.
Chains that slip through the filter are labelled. Credibility is worth more
than polish.

**4. The group decides, not the app.**
We rank; people choose. Anyone can veto, anyone can volunteer to travel
further. The app never announces a winner the group did not vote for.

**5. Respect the ninety seconds.**
No onboarding carousel, no account wall, no celebration animation between a
person and an answer. Speed is a brand attribute.

**6. Borrow nothing from social apps.**
No streaks, no badges, no notifications engineered for return visits. If
someone opens Midpoint twice a month and it works both times, that is success.

## 3. The mark

Two routes converging. **The gap between them is the midpoint** — the mark
draws the arriving and leaves the place itself as negative space.

```
assets/mark.svg
```

**Construction.** A 48-unit grid. Stroke 7, round caps and joins, 12-unit
reach, chevron apexes 6 units either side of centre. The gap is load-bearing:
tighten it and the mark becomes an X; widen it and it becomes two arrows
pointing away. Never redraw it by eye — use the file.

**Colour.** `--signal` on light or dark ground; `--ink` where a single colour is
required; reversed to `--signal-ink` inside a filled `--signal` shape. Never
any other colour, never a gradient, never an outline.

**Clear space.** On every side, no less than the width of the central gap —
6 units at drawing scale, 12.5% of the mark's width. Nothing enters it.

**Minimum size.** 16px. It was tested at 16, 20, 28, 44 and 80, and 16 is the
floor at which the gap survives. Below that, use the wordmark alone.

**Misuse.** Do not: rotate it, stretch it, add a third chevron, fill the gap,
place a dot in the gap, outline it, add a shadow, animate it, enclose it in a
circle, or set it in any colour outside those above.

## 4. Wordmark and lockup

**Wordmark:** *Midpoint*, Fraunces 500, `SOFT 20`, `WONK 1`, optical size to
match, tracking `-0.01em`. Always one word, always capital M, never all-caps,
never *MidPoint* or *midPoint*.

**Primary lockup:** mark left of the wordmark, mark height 0.62 of cap height,
optically centred, gap equal to the mark's clear space. This is what the app
header uses.

**Mark alone** is permitted only where the name appears within one screen —
app icon, favicon, avatar. Everywhere else the name must be present, because
nobody knows the mark yet and a symbol earns solo use over years.

## 5. App icon

The mark reversed out of a solid `--signal` field, 44/192 corner radius,
mark at 50% of the canvas. No gradient, no inner shadow, no glyph behind it.
On a phone home screen the icon competes with hundreds of others: a solid warm
orange field with a high-contrast white mark is the most legible thing we can
do, and legible beats decorated.

## 6. Colour

### What each colour means

Colour is never decorative. If a colour appears, it is doing one of these jobs.

| Token | Hex | Job — and only this |
|---|---|---|
| `--signal` | `#FF7A55` dark<br>`#D1442A` light | **The decision.** Primary action, the chosen spot, the mark. Per-theme, because a saturated mid-tone vibrates on a dark field. |
| `--agree` | `#3F7D5C` | Confirmed: on the map, open, voted for, settled. |
| `--caution` | `#C98A26` | Needs a human: an outlier, unknown hours, a blocked permission. |
| `--against` | `#A8382A` | Ruled out: vetoed, closed, refused. |

**One accent.** `--signal` carries the brand. A second accent requires a
written argument, because the moment two things are accented, neither is.

**The discipline that matters:** selected chips use `--ink`, not `--signal`. A
row of eight orange chips would spend the accent on something that is merely
*on*, leaving nothing for the thing that is *decided*.

### Neutrals

Near-neutral with a trace of warmth, and real distance between levels. The
first ramp was warm to the point of muddiness — three dark levels within ten
lightness points of each other, which read as sludge and made an orange accent
vibrate against it. Warmth is a trace, not a tint. **Cold blue-greys remain
prohibited**; so now does brown.

| Token | Dark | Light |
|---|---|---|
| `--ground` | `#0C0C0D` | `#F2F1EF` |
| `--surface` | `#17171A` | `#FFFFFF` |
| `--raised` | `#202024` | `#F7F6F4` |
| `--line` | `#2E2E34` | `#E2E0DC` |
| `--ink` | `#F4F3F1` | `#16161A` |
| `--ink-2` | `#A3A2A0` | `#5A5A5E` |
| `--ink-3` | `#737270` | `#8A8A8E` |

Both themes ship and both are tested. The app is used outdoors, where a dark
interface in sunlight is unreadable — light mode is a functional requirement,
not a preference.

### Route colours

The eight people, drawn the way transit systems draw parallel lines:
separable at a 10px dot, separable from one another for the colour-blind, and
harmonious as a set. Muted rather than neon — the warmth is the point.

| # | Hex | Name | | # | Hex | Name |
|---|---|---|---|---|---|---|
| 1 | `#E4572E` | Clay | | 5 | `#7B5EA7` | Iris |
| 2 | `#2E6F9E` | Harbour | | 6 | `#1F8A8A` | Teal |
| 3 | `#3F7D5C` | Moss | | 7 | `#C05286` | Fuchsia |
| 4 | `#C98A26` | Brass | | 8 | `#6E7A3A` | Olive |

Assigned in order. The first four are maximally separable because most groups
are two to four people. **A route colour never means anything but a person** —
it is not available for emphasis, charts or decoration.

### Proportion

Roughly **90% neutral, 8% route colour, 2% signal.** A screen where nothing is
happening is almost monochrome. If a screenshot looks colourful, something is
wrong.

### Misuse

Do not: introduce a colour outside this document; use `--signal` for anything
but the decision; use route colours decoratively; apply gradients; tint the
neutrals cool; or rely on colour alone to convey state.

## 7. Typography

Three families, all open-licence, free for commercial use, self-evidently
chosen rather than defaulted to.

| Family | Licence | Role |
|---|---|---|
| **Fraunces** | SIL OFL 1.1 | Display only. App name, the decision, empty-state headlines. |
| **System (SF Pro)** | Apple, on-device | Every interface label, button, input and body string. |
| **Archivo** | SIL OFL 1.1 | Fallback, and the interface face off Apple platforms. |
| **JetBrains Mono** | SIL OFL 1.1 | Every number: times, distances, tallies, session codes. |

**Fraunces** is warm, optically-sized and distinctly drawn — nothing about it
reads as a default. Used two or three times per screen at most, it does all the
identity work. Never below 20px, never as an interface label.

**The system font** carries the interface, because Apple's oldest interface
principle is deference and the system font is the most deferential type
available: the reader is not conscious of reading it. Setting every label in a
characterful face made the chrome compete with the content. Identity lives in
the display face and the mark, not in every button. Archivo is the fallback and
the face on anything that is not an Apple platform.

**JetBrains Mono** is tabular by construction with unambiguous `0`/`O` and
`1`/`l` — which matters when someone reads a session code aloud across a table.

Full scale, weights and rules: `docs/design-system.md` §3.

**Misuse.** Do not: set body copy in Fraunces; set numbers in Archivo; add a
fourth family; letterspace body or display; centre body text; or use faux bold
or faux italic.

## 8. Voice

**Midpoint sounds like a well-made instrument: precise, calm, and completely
uninterested in being liked.**

Four dimensions, each a position not an absolute:

| | We are | We are not |
|---|---|---|
| Register | Plain | Casual, chummy, slangy |
| Certainty | Specific | Hedging, or overclaiming |
| Warmth | Civil | Enthusiastic, exclamatory |
| Length | Short | Terse to the point of rudeness |

### Tone by situation

Tone shifts with what the person is doing; voice never does.

| Situation | Tone | Example |
|---|---|---|
| Everything working | Recede | "4 spots, ranked by drive time." |
| Something decided | Quietly definite | "Everyone has voted. 3 in favour." |
| Needs a choice | Neutral, both options real | "Keep it equal, or let Mike travel further." |
| Something failed **on our side** | Plain, no apology theatre | "Drive times unavailable — showing distance estimates." |
| Something failed **on theirs** | Lead with the fix | "Type a neighborhood instead — location is blocked for this site." |
| Nothing found | Say what was searched and what to change | "No independent cafés within 2 km. Try widening the activities." |

### Rules

- **Sentence case everywhere.** Never Title Case On Buttons.
- **Verbs on buttons**: "Find spots", "Go live", "Share my location". Never
  "Submit", "OK", or a bare noun.
- **Second person, present tense.** "You're on the map."
- **Numerals always.** "4 people", never "four people".
- **No exclamation marks. Ever.** No "Oops", no "Whoops", no "Uh oh".
- **Never apologise for the product's own behaviour.** State it and move on.
- **Name the person, not "a user".** "Mike is far from everyone else."
- **Never call anything "smart", "magic", "AI-powered" or "intelligent".**
  Describe what it did: "ranked by drive time".

### Words

| Use | Not |
|---|---|
| spot, place | venue *(interface only; fine in code)* |
| ruled out | rejected, vetoed *(interface)* |
| travel time | ETA, commute |
| session | room, lobby, party |
| everyone | all users, the group *(when addressing them)* |
| independent | local, indie, non-chain |

## 9. Categories

The activity taxonomy is brand surface: it is the first thing anyone reads.

**Naming.** One or two words, sentence case, concrete. "Games", not "Fun &
Entertainment". "Quiet", not "Study Spaces". No ampersands unless the pairing
is genuinely inseparable ("Zoo & aquarium").

**Emoji are permitted here and nowhere else.** On a category chip the emoji is
content — it makes a dense row scannable on a phone. In a button, banner,
heading or status line it is chrome, and chrome emoji is the single loudest
signal of a generated interface. One emoji per category, never two.

**A category must never return nothing.** A chip that can come back empty
undermines every other chip. Candidates are checked against real OSM coverage
before shipping; thin ones become search synonyms instead. See
`docs/osm-categories.md`.

**The long tail resolves upward.** Someone searching "axe throwing" gets Games.
Never a dead end where a broader answer exists.

## 10. Iconography and imagery

**Icons.** Line, 1.5–2px at 24px, round caps, matching the mark's language.
Only where a word will not do. A labelled button does not also need an icon.

**Photography: none.** Stock photographs of friends laughing over coffee are
the visual equivalent of an exclamation mark. The map is the imagery.

**Screenshots** (store listings, README) use real place names in a real city,
never `Lorem Ipsum` or "Example Café". Fake data in a screenshot is a small lie
about a product whose main asset is being trusted.

## 11. Motion

Two permitted uses: a state change (150ms, ease-out) and the map moving.
Nothing eases in on load, nothing bounces, nothing celebrates.
`prefers-reduced-motion: reduce` disables all of it, without exception.

## 12. The family

If Midpoint becomes the first of several apps, what carries:

**Fixed across the family** — the three typefaces and their roles, the warm
neutral ramp, the shape system, the space scale, the voice and its rules, the
accessibility floor.

**Per product** — the single accent, the mark, the name.

A sibling keeps every neutral and signal colour and chooses its own accent from
the same warm register. That is what makes a family read as a family rather
than as one app recoloured.

**Naming.** Real words, one or two syllables, concrete, no invented
portmanteaus, no dropped vowels, no `-ly` or `-ify`. *Midpoint* is a word that
already means the thing.

## 13. Accessibility

Part of the brand, not a compliance exercise. A product about fairness that
excludes people is incoherent.

- Body text at 4.5:1 minimum, in both themes, tested.
- **Colour is never the only signal.** Route colours pair with names; ruled-out
  spots are struck through as well as dimmed; open and closed are words.
- Targets 44×44 minimum.
- Visible focus rings; `outline: none` without a replacement is a defect.
- Every interactive element reachable and labelled for a screen reader.

## 14. Governance

This document is normative. Where the product and this document disagree, the
product is wrong and gets fixed.

**To change it:** open a pull request against this file in the same change as
the code. A colour, typeface or voice rule that changes only in the code is a
bug, and one that changes only here is a lie.

**Review** when a second product joins the family, or when something here has
been broken three times — three breaches means the rule is wrong, not the
people.
