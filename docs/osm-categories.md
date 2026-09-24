# OpenStreetMap categories — the 20% that covers 90%

Reference for the category catalog behind the mood chips and the planned
search box.

**On the numbers:** taginfo is unreachable from the build sandbox, so this is
ordered by OSM tagging convention and known mapping practice, not by verified
counts. Tiers are judgement, not measurement. Before a category ships, confirm
it empirically — the app already counts Overpass results, so a category that
returns nothing across a few real metros does not belong here.

**Tiers**
- **A — dense everywhere.** Safe to offer anywhere. Reliable in suburbs too.
- **B — good in cities, patchy outside.** Offer, but expect thin rural results.
- **C — real tag, inconsistently mapped.** Only as a synonym inside a broader
  category, never as a headline chip that can return nothing.

---

## 1. Food  ·  the single densest branch in OSM

| Tag | Tier | Notes |
|---|---|---|
| `amenity=restaurant` | **A** | The workhorse. Refine with `cuisine=*`. |
| `amenity=fast_food` | **A** | Counter service. Heavily chain-skewed — the independent-only filter matters most here. |
| `amenity=food_court` | C | Malls, airports. |
| `shop=deli` | B | |
| `amenity=marketplace` | B | Markets, often only open certain days. |

`cuisine=*` is a free-text key with long-tail spellings (`pizza`, `italian`,
`coffee_shop`). Good for synonym matching — "sushi", "tacos", "curry" — but
never rely on it alone; always pair with `amenity=restaurant`.

## 2. Coffee & bakery

| Tag | Tier | Notes |
|---|---|---|
| `amenity=cafe` | **A** | Also catches tea houses. |
| `shop=bakery` | **A** | Very well mapped. |
| `shop=coffee` | C | Beans to take away, not a place to sit. Exclude from "meet up". |
| `shop=pastry` | C | |
| `amenity=ice_cream` | B | |
| `shop=confectionery` / `shop=chocolate` | C | |

## 3. Drinks & nightlife

| Tag | Tier | Notes |
|---|---|---|
| `amenity=bar` | **A** | Dominant term in the US. |
| `amenity=pub` | **A** | Dominant in UK/IE. **Always query both** — the split is regional, not a difference in kind. |
| `amenity=biergarten` | B | Dense in Germany, sparse elsewhere. |
| `amenity=nightclub` | B | |
| `amenity=music_venue` | C | Newer tag, thinly adopted. Pair with `amenity=bar`. |
| `amenity=casino` | C | |

## 4. Outdoors

| Tag | Tier | Notes |
|---|---|---|
| `leisure=park` | **A** | One of the best-mapped things in OSM. |
| `leisure=garden` | B | Includes private gardens — check `access=*`. |
| `leisure=nature_reserve` | B | |
| `leisure=playground` | **A** | The one to offer when the group has kids. |
| `natural=beach` | B | |
| `tourism=picnic_site` | C | |
| `leisure=dog_park` | C | Surprisingly well mapped in US cities. |

## 5. Culture

| Tag | Tier | Notes |
|---|---|---|
| `tourism=museum` | **A** | |
| `tourism=gallery` | B | |
| `amenity=theatre` | B | Stage, not cinema. |
| `amenity=cinema` | **A** | Chain-heavy. |
| `amenity=arts_centre` | C | |
| `amenity=library` | **A** | Excellent for "somewhere quiet and free". |
| `historic=*` | B | Monuments and landmarks; very broad, good for wandering. |

## 6. Active & sport

| Tag | Tier | Notes |
|---|---|---|
| `leisure=fitness_centre` | **A** | Chain-heavy. |
| `leisure=sports_centre` | **A** | Broad umbrella; refine with `sport=*`. |
| `leisure=swimming_pool` | B | Includes private pools — check `access=*`. |
| `leisure=pitch` | **A** | Very dense but mostly unnamed, so most get filtered out. |
| `leisure=golf_course` | B | |
| `sport=climbing` | C | Usually on a `leisure=sports_centre`. |
| `leisure=horse_riding` | C | |

## 7. Games & entertainment

| Tag | Tier | Notes |
|---|---|---|
| `leisure=bowling_alley` | B | |
| `leisure=escape_game` | C | Real tag, thin coverage. Synonym only. |
| `leisure=trampoline_park` | C | |
| `leisure=miniature_golf` | C | |
| `leisure=amusement_arcade` | C | |
| `tourism=theme_park` | B | |
| `tourism=zoo` / `tourism=aquarium` | B | |

Billiards, darts, axe throwing, laser tag and karting have **no dependable
primary tag** — they appear as `sport=*` on a venue, if at all. The same is true
of the newer "competitive socializing" venues (Level99 and the like), which get
mapped as an arcade, a sports centre or just an attraction depending on the
mapper.

So the **Games** category deliberately casts a wide net: the specific `leisure=*`
values *plus* a loose `sport~laser_tag|paintball|axe_throwing|darts|billiards|
bowling|karting|climbing` match that picks them up whatever their primary tag
says. For venue types the community has not standardised, a wide OR beats a
precise filter that misses.

## 8. Browsing & shopping

| Tag | Tier | Notes |
|---|---|---|
| `shop=books` | B | Great "wander and chat" venue. |
| `shop=mall` | **A** | |
| `shop=department_store` | B | |
| `shop=second_hand` / `shop=charity` | C | |
| `shop=art` | C | |

## 9. Sightseeing

| Tag | Tier | Notes |
|---|---|---|
| `tourism=attraction` | B | Vague by design; catches what other tags miss. |
| `tourism=viewpoint` | **A** | Well mapped and genuinely nice for meeting. |
| `tourism=artwork` | B | Public art, murals. |

---

## Proposed chip set

Eight headline chips, all tier A or strong B, so every chip reliably returns
something. Everything else reaches the user through search synonyms.

| Chip | Tags |
|---|---|
| ☕ Coffee | `amenity=cafe`, `shop=bakery` |
| 🍽 Food | `amenity=restaurant`, `amenity=fast_food` |
| 🍺 Drinks | `amenity=bar`, `amenity=pub`, `amenity=biergarten` |
| 🌳 Outdoors | `leisure=park`, `leisure=garden`, `tourism=viewpoint` |
| 🎨 Culture | `tourism=museum`, `tourism=gallery`, `amenity=theatre` |
| 🎬 Screens | `amenity=cinema` |
| 🎯 Games | `leisure=bowling_alley`, `amusement_arcade`, `escape_game`, `miniature_golf`, `trampoline_park`, plus a `sport=*` net |
| 📚 Quiet | `amenity=library`, `shop=books` |

Gyms and sports centres moved out of the headline set into a searchable
**Active** category. "Let's go bowling" is a meetup; "let's meet at the gym"
mostly is not, and the chip slot is better spent on games.

## Rules the search box should follow

1. **Search synonyms, not tags.** People type "beer", "workout", "shoot pool" —
   never `amenity=biergarten`.
2. **Never offer a category that can return nothing.** A dead-end search reads
   as a broken app; a missing category reads as a missing category.
3. **Resolve the long tail upward.** "axe throwing" → Bars & Pubs beats "axe
   throwing" → no results.
4. **Query `bar` and `pub` together, always.** Which word a place carries is
   regional; the user does not care.
5. **Names are required.** Unnamed nodes are already filtered out, which is why
   `leisure=pitch` is dense in the data but sparse in results.
