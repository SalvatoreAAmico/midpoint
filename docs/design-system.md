# Midpoint Design System — "Waypoint"

The visual language for Midpoint and anything else built alongside it.

This document is normative. If the app and this document disagree, the app is
wrong.

---

## 0. Why the first version looked machine-made

Worth naming precisely, because "make it look better" is not actionable and
this list is. The original interface had every one of these tells:

| Tell | Why it reads as generated |
|---|---|
| `-apple-system` system font stack | The default of every starter template. No voice, no decision. |
| Cold blue-grey ground (`#0f1115`) with a blue accent (`#4f9cf9`) | The house style of every dark dashboard since 2019. |
| One radius (`14px`) on everything | A system with no opinion about what a thing *is*. |
| Emoji used as interface icons (⚡ 📍 🎲 🎉) | The single loudest tell. Emoji are content; borrowing them as chrome is a shortcut. |
| Uniform weight and size | Nothing is important, so nothing reads as important. |
| Saturated status colours (`#3fbf7f`, `#ef5f5f`) straight from a Tailwind-ish palette | Recognisably off-the-shelf. |
| No tabular numerals | Times and distances jitter as they update — the detail nobody notices until it is fixed. |

The fix is not decoration. It is **making choices that could only have been made
for this product.**

## 1. The idea

Midpoint is a **wayfinding instrument.** Routes converge on a point. That is
the whole product, and it has a rich design tradition to draw on: transit maps,
station signage, Swiss and Italian information design — Vignelli's New York
subway, London Underground, airport wayfinding.

That tradition is the right source because it is *authentic to the domain*
rather than borrowed from whatever is fashionable. It also solves a real
problem for free: transit systems have always needed a set of distinguishable
colours for parallel routes, which is exactly what per-person colours need.

**Waypoint is: warm, typographic, high-contrast, quiet, and confident about
where things are.**

It is **not**: playful, glassy, gradient-heavy, rounded-everything, or
neon-on-black.

## 2. Tenets

Guiding rules. Apply them when this document does not answer a question.

**1. A tool, not a feed.**
The app is open for ninety seconds while a group decides. Nothing may exist for
engagement. No streaks, no badges, no celebration animation that delays an
answer. Deciding faster is the only success metric.

**2. Type carries the identity; chrome recedes.**
Almost no borders, almost no boxes. Hierarchy comes from size, weight and
space. If a box can be removed without losing meaning, remove it.

**3. Warm ground, never cold grey.**
Every neutral carries warmth. Cold blue-greys are the default of generated
interfaces and are banned outright. Neutrals here sit around hue 30–40°.

**4. Colour means something or it is absent.**
Three jobs only: identifying a person, marking the decision, flagging a
problem. Colour is never decorative. A screen where nothing is happening is
almost monochrome.

**5. Numbers are first-class typography.**
Travel times, distances, tallies and session codes are the content. Always
tabular, always mono, always aligned. A number that shifts as it updates is a
bug.

**6. Shape has meaning.**
Pills move and can be pressed. Rectangles inform and cannot. A pill-shaped
non-interactive element is a lie, and so is a square button.

**7. Emoji are content, never chrome.**
Category markers may use emoji — they aid scanning a dense list on a phone, and
they *are* the content. Buttons, banners, headings and status messages may
never. No ⚡ on a button, no 🎉 on a result.

**8. Depth by hierarchy, not by effects.**
One elevation: the sheet above the map. No stacked shadows, no glassmorphism,
no gradient fills. Blur exists only where the map must show through.

**9. Honest empty and error states.**
Never a bare "no results". Say what was searched, why it came back empty, and
what to change. This is a design rule because it is mostly a writing problem.

**10. Motion only to explain.**
Two permitted uses: a state change (150ms), and the map moving. Nothing eases
in on load. Nothing bounces. Respect `prefers-reduced-motion` absolutely.

## 3. Typography

Three families, all open-licence and free for commercial use.

### Fraunces — display
Variable serif with optical-size, `WONK` and `SOFT` axes. Warm and distinctly
drawn; nothing about it reads as a default. Used **sparingly and large**: the
app name, the decision announcement, empty-state headlines. Never below 20px,
never for interface labels.

Why: 2026 has moved back toward expressive serif headlines, and Fraunces has
genuine character without being a novelty face. Used at one or two points per
screen, it does all the identity work.

### Archivo — interface
Grotesque drawn from signage and high-performance print, with a width axis.
Exceptional at small sizes on dense screens, which is the whole app. Every
label, button, input and body string.

Why: signage heritage is on-concept, and it holds up at 12px on a phone in
sunlight, which `Inter` — now so ubiquitous it reads as a non-choice — does not
do better.

### JetBrains Mono — data
Every number: travel times, distances, vote tallies, session codes. Tabular by
construction, unambiguous `0`/`O` and `1`/`l`, which matters when someone reads
a session code aloud.

### Scale

A restrained ratio. Most of the app lives in two sizes; the rest is emphasis.

| Token | Size / line | Family | Use |
|---|---|---|---|
| `display` | 34 / 1.05 | Fraunces 500 | App name, the decision |
| `title` | 21 / 1.2 | Fraunces 500 | Section moments, empty-state headlines |
| `heading` | 15 / 1.3 | Archivo 600 | Venue names, person names |
| `body` | 15 / 1.45 | Archivo 400 | Everything |
| `label` | 13 / 1.35 | Archivo 500 | Buttons, chips, inputs |
| `micro` | 11 / 1.3, +0.08em, uppercase | Archivo 600 | Section headers, tags |
| `data` | 13 / 1.2 | JetBrains Mono 500 | Times, distances, codes |

Rules:
- **Two type sizes per component, maximum.** A card with four sizes is noise.
- **Never centre body text.** Left-aligned; centring is for single display lines.
- Line length caps at 68 characters.
- Letterspacing only on `micro`. Never on body, never on display.

## 4. Colour

### Neutrals — warm, hue 30–38°

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ground` | `#14120F` | `#F7F4EE` | Page behind everything |
| `--surface` | `#1C1915` | `#FFFFFF` | The sheet |
| `--raised` | `#24201B` | `#F1ECE3` | Cards within the sheet |
| `--line` | `#332D26` | `#E0D8CB` | Hairlines only |
| `--ink` | `#F5F1EA` | `#1A1713` | Primary text |
| `--ink-2` | `#A9A093` | `#5E564C` | Secondary text |
| `--ink-3` | `#6F675C` | `#8C8378` | Tertiary, never below 12px |

Light mode is not an afterthought: this app is used outdoors, where a dark
interface in sunlight is unreadable. Both modes ship.

### Signals

| Token | Value | Meaning — and only this |
|---|---|---|
| `--signal` | `#E4572E` | The decision. The chosen spot, the primary action. |
| `--agree` | `#3F7D5C` | Confirmed, on the map, open now. |
| `--caution` | `#C98A26` | Needs attention: an outlier, unknown hours. |
| `--against` | `#A8382A` | Ruled out, blocked, closed. |

One accent — `--signal`. A second accent must be argued for in writing.

### Route colours — the eight people

Drawn as transit lines are: distinguishable at a 10px dot, distinguishable from
each other for the colour-blind, and harmonious as a set. Deliberately muted
rather than neon, which is the warmth the palette depends on.

| # | Hex | Name |
|---|---|---|
| 1 | `#E4572E` | Clay |
| 2 | `#2E6F9E` | Harbour |
| 3 | `#3F7D5C` | Moss |
| 4 | `#C98A26` | Brass |
| 5 | `#7B5EA7` | Iris |
| 6 | `#1F8A8A` | Teal |
| 7 | `#C05286` | Fuchsia |
| 8 | `#6E7A3A` | Olive |

Order matters: the first four must be maximally separable, since most groups
are two to four people.

## 5. Shape, space and depth

**Radius — three values, each with a meaning.**

| Token | Value | Applies to |
|---|---|---|
| `--r-pill` | `999px` | Anything pressable: buttons, chips, inputs, toggles |
| `--r-card` | `6px` | Panels and cards — sign-like, informational |
| `--r-none` | `0` | Full-bleed edges, dividers |

The sheet keeps a larger `18px` top radius only, because it is a physical
object sliding over the map.

**Space — a 4px base.** 4, 8, 12, 16, 24, 32, 48. Nothing between. Vertical
rhythm in multiples of 4 throughout.

**Depth — one elevation.** The sheet sits above the map with a single soft
shadow. Nothing else casts a shadow, ever. Cards are separated by ground
colour, not by elevation.

**Borders — hairlines, sparingly.** `1px --line`. If a card is already on a
different ground, it does not also get a border.

## 6. Components

**Buttons.** Pill. One primary per screen (`--signal`, ink-on-colour). Secondary
is a hairline outline on ground. Tertiary is text only. Minimum target 44×44,
no exceptions.

**Chips.** Pill, `label` type. Selected is filled with `--ink` on dark ground —
*not* with `--signal`. The accent belongs to the decision, and a row of eight
accent chips devalues it.

**Cards (venues).** `--r-card`, on `--raised`, no border, no shadow. Rank in
mono at the left. Name in `heading`. Metadata in `micro`. Fairness bars use
route colours at 6px.

**Inputs.** Pill, `--surface` ground, hairline border, `--signal` on focus.
16px minimum font size, since anything smaller makes iOS Safari zoom on focus.

**The sheet.** 18px top corners, single shadow, `--surface`. Drag handle is
decorative and stays.

**Map pins.** Circles in route colours with a 2px `--ground` ring. The
midpoint is a hollow ring, not a filled dot — it is a place, not a person.

## 7. Writing

Voice is part of the visual system.

- **Sentence case everywhere.** Never Title Case On Buttons.
- **Verbs on buttons**: "Find spots", not "Search". "Go live", not "Live mode".
- **Second person, present tense**: "You're on the map."
- **Never apologise, never exclaim.** No "Oops!", no "!" in the interface.
- **Numbers as numerals**, always: "4 people", never "four people".
- **Errors state the fix, not the fault**: not "Location permission denied" but
  "Type a neighbourhood instead — location is blocked for this site."

## 8. Accessibility — non-negotiable

- Body text at 4.5:1 minimum; `--ink-3` only at 12px and above, and never for
  anything that must be read.
- **Colour is never the only signal.** Route colours pair with names. Vetoed
  venues are struck through as well as dimmed. Open/closed is a word, not a hue.
- Targets 44×44 minimum.
- Visible focus rings; never `outline: none` without a replacement.
- `prefers-reduced-motion: reduce` disables every transition.
- Both themes meet contrast independently.

## 9. Applying this beyond Midpoint

For a shared ecosystem, what carries across:

**Fixed:** the three families and their roles, the warm neutral ramp, the shape
system, the space scale, the writing rules, the accessibility floor.

**Per-product:** `--signal`. Midpoint's is Clay. A sibling app picks its own
single accent from the same warm register, keeping the neutrals and the
signals identical.

That is what makes a family recognisable as a family rather than as one app
recoloured.
