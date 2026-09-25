/* Midpoint — fair meetup spots for up to 4 people.
   Zero backend, zero API keys, zero cost.
   Data: OpenStreetMap (Nominatim geocoding, Overpass places) + OSRM (drive times). */

'use strict';

const MAX_PEOPLE = 8;
const MAX_VENUES = 25;            // also caps the OSRM matrix URL length
/* Route colours, drawn as transit lines are: separable at a 10px dot and
   harmonious as a set. The first four are maximally distinct, since most
   groups are two to four people. See docs/design-system.md. */
/* Route colours: the eight people, drawn from things that are actually those
   colours — fern, lake, teal, heather, moss, sand, clay, slate. Greens and
   blues lead, which is where the palette lives; the warm ones exist because
   eight people still have to be told apart at a 10px dot. The first is the
   brand green: the first row is almost always you. */
const COLORS = ['#4FB07A', '#3E8FC4', '#2FA5A5', '#9A86C4',
                '#7E9B4E', '#D9A85C', '#C7715A', '#6F87A8'];
/* Fallback speeds in m/s when the routing service is unavailable. Walking
   includes a detour factor: streets are not straight lines. */
const SPEED = { drive: 13.4, walk: 1.05 };
const MAX_RADIUS = { drive: 20000, walk: 2500 };

/* Everyone in the same place is a real case — two phones on one sofa, or a
   group already together deciding where to go next. There is no fairness
   question left to answer, so the constraint stops being "who travels" and
   becomes "what is worth going to". Search wider than the usual floor. */
const TOGETHER_M = 250;
const TOGETHER_RADIUS = { drive: 4000, walk: 1500 };

/* Placeholder names, so a session is not four rows of "Me". Deterministic from
   the participant id: every device derives the same name for the same person
   with no coordination, and it survives a reload. 48 x 40 combinations, so a
   clash inside a group of eight is vanishingly unlikely. Adjective plus animal
   — nothing trademarked, nothing anyone could object to, and obviously a
   placeholder so people replace it. */
const CODE_ADJ = ['Brisk','Sleepy','Punctual','Hungry','Lost','Casual','Eager','Patient',
  'Restless','Curious','Mellow','Rowdy','Polite','Distant','Nimble','Sturdy','Cheerful',
  'Grumpy','Sunny','Foggy','Lucky','Late','Early','Wandering','Dapper','Humble','Bold',
  'Quiet','Swift','Idle','Keen','Jolly','Crisp','Bright','Solemn','Breezy','Tidy',
  'Scruffy','Gallant','Modest','Chipper','Drowsy','Spry','Stoic','Fussy','Zesty',
  'Amiable','Weary'];
const CODE_ANIMAL = ['Otter','Badger','Heron','Marmot','Puffin','Ferret','Walrus','Gibbon',
  'Lemur','Wombat','Tapir','Beaver','Raccoon','Magpie','Kestrel','Newt','Pelican','Ibex',
  'Okapi','Quokka','Narwhal','Meerkat','Capybara','Hedgehog','Mongoose','Albatross',
  'Stoat','Vole','Weasel','Bison','Moose','Osprey','Falcon','Toucan','Iguana','Gecko',
  'Axolotl','Manatee','Platypus','Dormouse'];

function codename(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CODE_ADJ[h % CODE_ADJ.length] + ' ' + CODE_ANIMAL[(h >>> 8) % CODE_ANIMAL.length];
}

const LUCKY_CATS = 3;    // how many activity types a roll picks
const LUCKY_POOL = 12;   // shuffle within this many of the fairest spots

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/table/v1/';

/* Category catalogue. See docs/osm-categories.md for why these tags and not
   others. Rules that shaped it:
     - `chip: true` entries are the headline chips. Every one is densely enough
       mapped that it cannot come back empty — a chip that returns nothing
       reads as a broken app.
     - Everything else is reachable by search.
     - `syn` is what people actually type. Nobody types amenity=biergarten.
     - Long-tail wants resolve UPWARD: "axe throwing" finds bars rather than
       finding nothing.
   A tag may AND several conditions with `&`, and `~` matches a value loosely,
   which is how cuisine searches work (cuisine is often a semicolon list). */
const CATALOG = [
  // ---- headline chips -------------------------------------------------
  { id:'coffee',  label:'☕ Coffee',   chip:1, lucky:1, tags:['amenity=cafe','shop=bakery'],
    syn:'coffee cafe espresso latte cappuccino tea bakery pastry croissant brunch breakfast' },
  { id:'food',    label:'🍽 Food',     chip:1, lucky:1, tags:['amenity=restaurant','amenity=fast_food'],
    syn:'food eat dinner lunch restaurant meal hungry supper bite' },
  { id:'drinks',  label:'🍺 Drinks',   chip:1, lucky:1, tags:['amenity=bar','amenity=pub','amenity=biergarten'],
    syn:'drinks beer bar pub cocktails wine happy hour pint tavern brewery '
       +'karaoke trivia pool darts' },
  { id:'outdoors',label:'🌳 Outdoors', chip:1, lucky:1, tags:['leisure=park','leisure=garden','tourism=viewpoint'],
    syn:'park outside outdoors walk stroll nature green grass picnic view viewpoint sunset fresh air' },
  { id:'culture', label:'🎨 Culture',  chip:1, lucky:1, tags:['tourism=museum','tourism=gallery','amenity=theatre'],
    syn:'culture museum art gallery exhibit exhibition theatre theater play show' },
  { id:'screens', label:'🎬 Screens',  chip:1, lucky:1, tags:['amenity=cinema'],
    syn:'movie movies cinema film screening flick theater' },
  { id:'games',   label:'🎯 Games',    chip:1, lucky:1,
    tags:['leisure=bowling_alley','leisure=amusement_arcade','leisure=escape_game',
          'leisure=miniature_golf','leisure=trampoline_park','leisure=adult_gaming_centre',
          // Venues like Level99 have no settled tag and get mapped as an arcade,
          // a sports centre or just an attraction. Matching on sport=* catches
          // them whatever their primary tag says.
          'sport~laser_tag|paintball|axe_throwing|darts|billiards|bowling|karting|climbing'],
    syn:'games gaming fun activity activities things to do bowling bowl arcade '
       +'escape room escape rooms axe throwing hatchet laser tag paintball '
       +'mini golf minigolf putt putt trampoline go karts karting darts '
       +'billiards pool table shuffleboard vr virtual reality level 99 level99 '
       +'competitive socializing pinball barcade' },
  { id:'quiet',   label:'📚 Quiet',    chip:1, lucky:1, tags:['amenity=library','shop=books'],
    syn:'quiet library books bookshop bookstore read study work laptop calm' },

  // ---- searchable ------------------------------------------------------
  { id:'active',  label:'🏃 Active', lucky:1,
    tags:['leisure=sports_centre','leisure=fitness_centre','leisure=climbing','sport~climbing|yoga'],
    syn:'active sport sports gym workout exercise fitness climbing bouldering yoga pilates' },
  { id:'icecream', label:'🍦 Ice cream', lucky:1, tags:['amenity=ice_cream','shop=confectionery','shop=chocolate'],
    syn:'ice cream gelato dessert sweets candy chocolate sundae frozen yogurt' },
  { id:'nightlife',label:'🪩 Nightlife', tags:['amenity=nightclub'],
    syn:'nightclub club clubbing dancing dance night dj late' },
  { id:'playground',label:'🛝 Playground', lucky:1, tags:['leisure=playground'],
    syn:'playground kids children family toddler swings park for kids' },
  { id:'dogpark',  label:'🐕 Dog park', tags:['leisure=dog_park'],
    syn:'dog dogs puppy dog park dog run' },
  { id:'beach',    label:'🏖 Beach', tags:['natural=beach'],
    syn:'beach sand lake shore waterfront lakefront' },
  { id:'nature',   label:'🏞 Nature', lucky:1, tags:['leisure=nature_reserve'],
    syn:'nature hike hiking trail trails reserve woods forest wildlife' },
  { id:'swimming', label:'🏊 Swimming', tags:['leisure=swimming_pool','leisure=water_park'],
    syn:'swim swimming pool water park laps' },
  { id:'golf',     label:'⛳ Golf', tags:['leisure=golf_course','leisure=driving_range'],
    syn:'golf course driving range putting green' },
  { id:'zoo',      label:'🦓 Zoo & aquarium', lucky:1, tags:['tourism=zoo','tourism=aquarium'],
    syn:'zoo aquarium animals fish penguins safari' },
  { id:'themepark',label:'🎢 Theme park', tags:['tourism=theme_park'],
    syn:'theme park amusement park rides roller coaster fair carnival' },
  { id:'shopping', label:'🛍 Shopping', lucky:1, tags:['shop=mall','shop=department_store'],
    syn:'shop shopping mall stores browse retail window shopping' },
  { id:'market',   label:'🧺 Market', tags:['amenity=marketplace'],
    syn:'market farmers market stalls bazaar flea market' },
  { id:'landmarks',label:'🏛 Landmarks', lucky:1, tags:['historic=monument','historic=memorial','tourism=artwork','tourism=attraction'],
    syn:'landmark landmarks monument historic history statue mural public art sightseeing tourist' },
  { id:'arts',     label:'🎭 Arts centre', tags:['amenity=arts_centre','amenity=community_centre'],
    syn:'arts centre arts center performance community centre workshop' },
  { id:'deli',     label:'🥪 Deli', tags:['shop=deli'],
    syn:'deli sandwich sandwiches sub hoagie lunch counter' },

  // ---- cuisines: restaurant/fast food narrowed by cuisine --------------
  { id:'pizza',   label:'🍕 Pizza', cuisine:1,     tags:['amenity=restaurant&cuisine~pizza','amenity=fast_food&cuisine~pizza'], syn:'pizza pizzeria slice' },
  { id:'sushi',   label:'🍣 Sushi', cuisine:1,     tags:['amenity=restaurant&cuisine~sushi|japanese'], syn:'sushi japanese sashimi ramen izakaya' },
  { id:'mexican', label:'🌮 Mexican', cuisine:1,   tags:['amenity=restaurant&cuisine~mexican|taco','amenity=fast_food&cuisine~mexican|taco'], syn:'mexican tacos taco burrito taqueria' },
  { id:'italian', label:'🍝 Italian', cuisine:1,   tags:['amenity=restaurant&cuisine~italian'], syn:'italian pasta trattoria' },
  { id:'chinese', label:'🥡 Chinese', cuisine:1,   tags:['amenity=restaurant&cuisine~chinese|dim_sum'], syn:'chinese dim sum dumplings szechuan' },
  { id:'thai',    label:'🍜 Thai', cuisine:1,      tags:['amenity=restaurant&cuisine~thai|vietnamese'], syn:'thai vietnamese pho noodles curry' },
  { id:'indian',  label:'🍛 Indian', cuisine:1,    tags:['amenity=restaurant&cuisine~indian'], syn:'indian curry tandoori' },
  { id:'korean',  label:'🍲 Korean', cuisine:1,    tags:['amenity=restaurant&cuisine~korean'], syn:'korean bbq bibimbap' },
  { id:'burger',  label:'🍔 Burgers', cuisine:1,   tags:['amenity=restaurant&cuisine~burger','amenity=fast_food&cuisine~burger'], syn:'burger burgers hamburger' },
  { id:'bbq',     label:'🍖 BBQ', cuisine:1,       tags:['amenity=restaurant&cuisine~barbecue|bbq'], syn:'bbq barbecue barbeque ribs brisket smokehouse' },
  { id:'seafood', label:'🦞 Seafood', cuisine:1,   tags:['amenity=restaurant&cuisine~seafood|fish'], syn:'seafood fish oysters lobster crab' },
  { id:'vegan',   label:'🥗 Vegan', cuisine:1,     tags:['amenity=restaurant&cuisine~vegan|vegetarian'], syn:'vegan vegetarian plant based salad healthy' },
  { id:'mediterranean', label:'🥙 Mediterranean', cuisine:1, tags:['amenity=restaurant&cuisine~mediterranean|greek|turkish|lebanese'], syn:'mediterranean greek turkish lebanese falafel kebab gyro' }
];

const CATS = Object.fromEntries(CATALOG.map(c => [c.id, c]));
const CHIP_CATS = CATALOG.filter(c => c.chip).map(c => c.id);
const CUISINES  = CATALOG.filter(c => c.cuisine).map(c => c.id);

/* Match on what people type. Every word of the query must appear somewhere in
   the label or synonyms, so "mini golf" narrows rather than widening. */
function searchCats(q) {
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return CATALOG
    .map(c => {
      const hay = (c.label + ' ' + c.syn).toLowerCase();
      if (!words.every(w => hay.includes(w))) return null;
      // Prefer a label match, then a synonym starting with the query.
      const label = c.label.toLowerCase();
      const rank = label.includes(words[0]) ? 0 : hay.startsWith(words[0]) ? 1 : 2;
      return { c, rank };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.c.label.localeCompare(b.c.label))
    .map(x => x.c)
    .slice(0, 8);
}

/* Chain detection. OpenStreetMap tags branded venues with `brand` and
   `brand:wikidata`; an independent cafe essentially never carries either, so
   that is the primary signal. The name list is a backup for franchises whose
   local entries were added without brand tags. */
const CHAIN_NAMES = new RegExp([
  'starbucks', 'dunkin', "peet'?s", 'caribou coffee', 'tim hortons', 'costa coffee',
  'pret a manger', 'panera', 'au bon pain', 'corner bakery', 'einstein bros',
  'dutch bros', "scooter'?s coffee", "mcdonald'?s", 'burger king', "wendy'?s",
  'subway', 'taco bell', 'kfc', 'popeyes', 'chipotle', 'panda express',
  'five guys', 'shake shack', 'sweetgreen', 'chick-?fil-?a', 'domino', 'papa john',
  "applebee'?s", "chili'?s", 'olive garden', 'buffalo wild wings', "friday'?s",
  "denny'?s", 'ihop', 'cracker barrel', 'red lobster', 'outback', 'hooters',
  'barnes ?& ?noble', 'planet fitness', 'la fitness', 'equinox', 'orangetheory',
  'amc ', 'regal ', 'cinemark'
].join('|'), 'i');

function isChain(tags, name) {
  if (tags['brand'] || tags['brand:wikidata'] || tags['brand:wikipedia']) return true;
  return CHAIN_NAMES.test(name || '');
}

const state = {
  people: [],
  cats: ['coffee'],
  lucky: false,
  travel: 'drive',    // 'drive' | 'walk'
  when: '',           // '' any time | 'now' | '0'-'6' weekday
  whenTime: '19:00',
  noChains: true,     // on by default: the midpoint Starbucks is a bad answer
  maxPrice: '',
  mode: 'drive',
  votes: {},        // { venueKey: { personId: 1 | -1 } }
  me: null,         // this device's person id, so votes attribute correctly
  results: [],
  center: null,
  estimated: false,
  liveErr: '',
  geoBlocked: false,
  showVetoed: false,
  searching: false,
  together: false,
  resultsAt: 0
};

const isLive = () => window.Sync?.live;

/* Browsers deliberately do not expose the device name, so the best we can do
   is remember what you called yourself last time. Storage can throw in private
   browsing, so every access is guarded. */
const NAME_KEY = 'midpoint.name';
const GROUPS_KEY = 'midpoint.groups';
const MAX_GROUPS = 12;

/* Saved groups. The commonest real use is the same handful of people over and
   over, and retyping them every time is the reason nobody opens an app twice.
   Deliberately local: this needs no account, no backend and no permission, so
   it works for everyone immediately. */
function loadGroups() {
  try {
    const v = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]');
    return Array.isArray(v) ? v.filter(g => g && g.name && Array.isArray(g.people)) : [];
  } catch { return []; }
}

function storeGroups(list) {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(list.slice(0, MAX_GROUPS))); }
  catch { /* private browsing, or full */ }
}

/* Only what is worth restoring. Ids are regenerated on load so a group can be
   loaded twice, or loaded into a session that already has people. */
function groupFromPeople(name, people) {
  return {
    id: uid(),
    name: name.trim().slice(0, 40),
    people: people
      .filter(p => p.name?.trim() || p.lat != null)
      .map(p => ({ name: p.nameAuto ? '' : (p.name || ''), label: p.label || '',
                   lat: p.lat ?? null, lon: p.lon ?? null, flex: !!p.flex }))
      .slice(0, MAX_PEOPLE)
  };
}

/* A name you would recognise in a list, from the people in it. */
function suggestGroupName(people) {
  const names = people.map(p => p.name?.trim()).filter(Boolean);
  if (!names.length) return '';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}
const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const saveName  = n => { try { n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY); } catch {} };

/* ------------------------------------------------------------------ utils */

const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function log(msg, spinning) {
  $('#log').innerHTML = msg ? (spinning ? '<span class="spin"></span>' : '') + esc(msg) : '';
}

/* Great-circle distance in metres. */
function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const la1 = a.lat * rad, la2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Centroid via 3-D cartesian mean, so it behaves near the poles / date line. */
function centroid(pts) {
  if (!pts.length) return null;
  const rad = Math.PI / 180;
  let x = 0, y = 0, z = 0;
  for (const p of pts) {
    const la = p.lat * rad, lo = p.lon * rad;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const n = pts.length;
  x /= n; y /= n; z /= n;
  return {
    lat: Math.atan2(z, Math.hypot(x, y)) / rad,
    lon: Math.atan2(y, x) / rad
  };
}

/* Fisher-Yates. Array.sort(() => Math.random() - 0.5) is not a shuffle —
   it biases badly and varies by engine. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pickRandom = (arr, n) => shuffle(arr).slice(0, n);

const fmtMin = s => s == null ? '—' : (s < 60 ? '<1 min' : Math.round(s / 60) + ' min');
const fmtKm  = m => m == null ? '—' : (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km');

/* ------------------------------------------------- opening_hours (subset) */
/* Handles the common shapes: "24/7", "Mo-Fr 08:00-18:00", "Mo-Sa 09:00-22:00; Su 10:00-16:00".
   Anything it can't parse returns null = "unknown", and unknowns are never filtered out. */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function isOpenNow(spec, now = new Date()) {
  if (!spec) return null;
  const s = spec.trim();
  if (/^24\/7$/i.test(s)) return true;

  const today = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  let parsedAny = false;   // any rule we understood, on any day
  let coversToday = false; // ...and at least one of them applies to today

  for (const rule of s.split(';')) {
    const m = rule.trim().match(
      /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/i
    );
    if (!m) continue;
    const dayPart = m[1], timePart = m[2];
    if (!timePart) continue;

    // Which days does this rule cover? No day prefix = every day.
    let covers = !dayPart;
    if (dayPart) {
      for (const grp of dayPart.split(',')) {
        const [a, b] = grp.split('-');
        const ia = DAYS.indexOf(a), ib = b ? DAYS.indexOf(b) : ia;
        if (ia < 0 || ib < 0) continue;
        // inclusive range that may wrap (e.g. Sa-Su)
        for (let i = ia; ; i = (i + 1) % 7) {
          if (i === today) covers = true;
          if (i === ib) break;
        }
      }
    }
    if (/^off|closed/i.test(timePart)) { parsedAny = true; continue; }

    for (const span of timePart.split(',')) {
      const t = span.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
      if (!t) continue;
      parsedAny = true;                                 // we understood this rule
      if (!covers) continue;                            // ...but it isn't today's
      coversToday = true;
      const from = +t[1] * 60 + +t[2];
      let to = +t[3] * 60 + +t[4];
      if (to <= from) to += 1440;                       // closes after midnight
      if (mins >= from && mins < to) return true;
      if (mins + 1440 >= from && mins + 1440 < to) return true;
    }
  }
  // A spec we understood that names no open window for right now means closed —
  // including days it simply doesn't mention (Mo-Fr says nothing about Sunday).
  return parsedAny || coversToday ? false : null;
}

/* Which maps app a link opens. A personal preference, so it stays on the
   device rather than travelling with the session. Apple Maps is the sensible
   default on an iPhone and is unavailable elsewhere. */
const MAPS_KEY = 'midpoint.maps';
const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

function mapsPref() {
  try { return localStorage.getItem(MAPS_KEY) || (isApple ? 'apple' : 'google'); }
  catch { return isApple ? 'apple' : 'google'; }
}
function setMapsPref(v) { try { localStorage.setItem(MAPS_KEY, v); } catch {} }

function mapsUrl(v, app) {
  const q = encodeURIComponent(v.name || '');
  const ll = `${v.lat},${v.lon}`;
  switch (app || mapsPref()) {
    case 'apple':  return `https://maps.apple.com/?q=${q}&ll=${ll}`;
    case 'osm':    return `https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lon}#map=18/${v.lat}/${v.lon}`;
    default:       return `https://www.google.com/maps/search/?api=1&query=${ll}&query_place_id=`
                        + `&query=${q}%20${ll}`;
  }
}
const mapsLabel = () => ({ apple: 'Apple Maps', google: 'Google Maps', osm: 'OpenStreetMap' }[mapsPref()]);

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* The moment to test opening hours against: null means "don't filter by time".
   A weekday resolves to its next occurrence, so picking Friday on a Saturday
   means the Friday coming, not the one just gone. */
function whenDate() {
  if (!state.when) return null;
  if (state.when === 'now') return new Date();
  const [h, m] = (state.whenTime || '19:00').split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() + ((+state.when - d.getDay() + 7) % 7));
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function whenLabel() {
  if (!state.when) return '';
  if (state.when === 'now') return 'now';
  const [h, m] = (state.whenTime || '19:00').split(':').map(Number);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${DAY_NAMES[+state.when].slice(0,3)} ${h12}${m ? ':' + String(m).padStart(2,'0') : ''}${ampm}`;
}

/* OSM price data is sparse. Read it where it exists; never guess, never
   exclude a venue just because the tag is missing. */
function priceLevel(tags) {
  const raw = tags['price:range'] || tags['price_range'] || tags['price'];
  if (!raw) return null;
  const m = String(raw).match(/\${1,4}/);
  if (m) return m[0].length;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : null;
}

/* ------------------------------------------------------------- URL state */
/* The whole session lives in the URL hash — that's the "multi-user" trick.
   No server, no database, no accounts. */

function encodeState() {
  const payload = {
    p: state.people.map(p => [p.id, p.name, p.lat == null ? null : +p.lat.toFixed(5),
                              p.lon == null ? null : +p.lon.toFixed(5), p.label || '',
                              p.flex ? 1 : 0]),
    c: state.cats, tv: state.travel, w: state.when, wt: state.whenTime, r: state.maxPrice,
    v: state.votes, l: state.lucky ? 1 : 0, n: state.noChains ? 1 : 0
  };
  const json = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(hash) {
  try {
    const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    const d = JSON.parse(decodeURIComponent(escape(atob(b64))));
    state.people = (d.p || []).slice(0, MAX_PEOPLE).map(a => ({
      id: a[0], name: a[1] || '', lat: a[2], lon: a[3], label: a[4] || '',
      flex: !!a[5], status: ''
    }));
    state.cats    = Array.isArray(d.c) && d.c.length ? d.c : ['coffee'];
    // `o` is the old open-now boolean from links made before this control.
    state.when     = d.w !== undefined ? String(d.w) : (d.o ? 'now' : '');
    state.whenTime = d.wt || '19:00';
    state.travel = d.tv === 'walk' ? 'walk' : 'drive';
    state.maxPrice = d.r || '';
    state.lucky   = !!d.l;
    // Absent in links made before this filter existed; default it on.
    state.noChains = d.n === undefined ? true : !!d.n;
    state.votes   = d.v && typeof d.v === 'object' ? d.v : {};
    return true;
  } catch { return false; }
}

/* The session code lives in the query string and local state in the hash.
   Writing one must not drop the other: `#state` alone discards ?s=, and
   `?s=code` alone discards the hash. */
function syncURL() {
  history.replaceState(null, '',
    location.pathname + location.search + '#' + encodeState());
}

function setSessionParam(code) {
  const search = code ? `?s=${encodeURIComponent(code)}` : '';
  history.replaceState(null, '', location.pathname + search + location.hash);
}

/* ------------------------------------------------------------- geocoding */

const geoCache = new Map();
const revCache = new Map();

/* Nominatim's address fields, rendered the way people actually name places:
   the specific part, then the wider one it sits in. County is skipped — few
   people say "Worcester County" — and the wider part is dropped when it merely
   repeats the specific one, which is why a whole town reads as "Leominster,
   Massachusetts" rather than "Leominster, Leominster". */
function placeName(addr = {}, displayName = '') {
  const local = addr.neighbourhood || addr.suburb || addr.quarter || addr.city_district
             || addr.village || addr.town || addr.city || addr.municipality;
  const wider = [addr.city, addr.town, addr.state].find(
    x => x && x.toLowerCase() !== (local || '').toLowerCase());
  const out = [local, wider].filter(Boolean).join(', ');
  return out || displayName.split(',').slice(0, 2).join(',').trim();
}

/* Coordinates -> a name a human recognises. "My location" tells you nothing
   about where you actually are, which matters when several people are
   comparing rows. zoom=14 lands on neighbourhood rather than street or city. */
async function reverseGeocode(lat, lon) {
  const key = lat.toFixed(4) + ',' + lon.toFixed(4);
  if (revCache.has(key)) return revCache.get(key);
  const url = `${NOMINATIM.replace('/search', '/reverse')}`
    + `?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Reverse geocoder ' + res.status);
  const d = await res.json();
  const out = placeName(d.address, d.display_name || '');
  revCache.set(key, out);
  return out;
}

async function geocode(q) {
  const key = q.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key);

  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Geocoder returned ' + res.status);
  const hits = await res.json();
  if (!hits.length) return null;

  const out = {
    lat: parseFloat(hits[0].lat),
    lon: parseFloat(hits[0].lon),
    label: placeName(hits[0].address, hits[0].display_name)
  };
  geoCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------- overpass */

/* "amenity=restaurant&cuisine~pizza" -> ["amenity"="restaurant"]["cuisine"~"pizza",i]
   `=` is exact, `~` is a case-insensitive regex, which is what cuisine needs
   since it is often a semicolon-separated list. */
function tagFilter(spec) {
  return spec.split('&').map(part => {
    const m = part.match(/^([^=~]+)([=~])(.+)$/);
    if (!m) return '';
    const [, k, op, v] = m;
    return op === '=' ? `["${k}"="${v}"]` : `["${k}"~"${v}",i]`;
  }).join('');
}

function overpassQuery(center, radiusM) {
  const sel = [];
  const at = `(around:${Math.round(radiusM)},${center.lat.toFixed(5)},${center.lon.toFixed(5)});`;
  for (const c of state.cats) {
    for (const t of (CATS[c]?.tags || [])) {
      sel.push('nwr' + tagFilter(t) + at);
    }
  }
  return `[out:json][timeout:25];(${sel.join('')});out center 120;`;
}

async function fetchVenues(center, radiusM) {
  const body = 'data=' + encodeURIComponent(overpassQuery(center, radiusM));
  let lastErr;
  for (const host of OVERPASS) {
    try {
      const res = await fetch(host, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!res.ok) throw new Error('Overpass ' + res.status);
      const data = await res.json();
      return (data.elements || []).map(el => {
        const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) return null;
        const tags = el.tags || {};
        if (!tags.name) return null;                    // unnamed nodes are noise
        return {
          key: el.type + '/' + el.id,
          name: tags.name,
          kind: tags.amenity || tags.leisure || tags.tourism || tags.shop || '',
          lat, lon,
          hours: tags.opening_hours || '',
          price: priceLevel(tags),
          chain: isChain(tags, tags.name)
        };
      }).filter(Boolean);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Overpass unreachable');
}

/* ----------------------------------------------------------------- OSRM */
/* One /table request returns every person x every venue travel time.
   4 people x 25 venues = 100 durations for a single HTTP call. */

async function driveTimes(people, venues, profile = 'driving') {
  const coords = [...people, ...venues]
    .map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const sources = people.map((_, i) => i).join(';');
  const dests = venues.map((_, i) => i + people.length).join(';');
  const url = `${OSRM}${profile}/${coords}?sources=${sources}&destinations=${dests}&annotations=duration`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('OSRM ' + res.status);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.durations) throw new Error('OSRM ' + data.code);
    return data.durations;                              // [person][venue] seconds
  } finally { clearTimeout(timer); }
}

/* ------------------------------------------------------------- scoring */
/* Lower is better. Average cost keeps the spot central; the spread penalty is
   what stops one person always eating the whole drive. */

const SPREAD_WEIGHT = 0.9;
const FLEX_WEIGHT = 0.35;   // how much someone who volunteered still counts

/* Lower is better. The average keeps the spot central; the spread penalty is
   what stops one person absorbing the whole journey.

   Anyone who has said they don't mind travelling counts less in the average
   and is left out of the spread entirely. Without that, a single person far
   from the rest drags the whole group toward them — technically equal, and
   a trade nobody would choose: seven people each going an hour out of their
   way to save one person an hour. */
function scoreVenues(venues, people, matrix, speed = SPEED.drive) {
  const w = people.map(p => (p.flex ? FLEX_WEIGHT : 1));
  const wSum = w.reduce((a, b) => a + b, 0);
  const fixed = people.map((p, i) => i).filter(i => !people[i].flex);

  return venues.map((v, vi) => {
    const costs = people.map((p, pi) =>
      matrix ? matrix[pi][vi] : haversine(p, v) / speed);
    if (costs.some(c => c == null || !Number.isFinite(c))) return null;

    const mean = costs.reduce((a, b, i) => a + b * w[i], 0) / wSum;
    /* Spread over the people who did not volunteer. With exactly one of them
       the spread is zero, which is correct: there is no fairness to balance,
       only that person's journey to minimise. The previous guard required two
       and fell back to everyone's times, which made volunteering do almost
       nothing in a pair — the commonest group there is. */
    const pool = fixed.length ? fixed.map(i => costs[i]) : costs;
    const spread = Math.max(...pool) - Math.min(...pool);
    return { ...v, costs, mean, spread, score: mean + SPREAD_WEIGHT * spread };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
}

/* Someone far enough from everyone else that no single spot can serve them.
   Compared against the median distance so one outlier cannot hide another. */
function findOutliers(people) {
  const located = people.filter(p => p.lat != null);
  if (located.length < 3) return [];
  const c = centroid(located);
  const d = located.map(p => haversine(p, c));
  const sorted = [...d].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  return located.filter((p, i) => d[i] > Math.max(3 * median, 25000) && !p.flex);
}

/* ------------------------------------------------------------------ map */

let map, layer;

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true })
        .setView([39.83, -98.58], 3);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
}

function circleIcon(color, size, ring) {
  return L.divIcon({
    className: '',
    html: `<div class="pin${ring ? ' mid' : ''}" style="width:${size}px;height:${size}px;background:${color}"></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2]
  });
}

function drawMap(selectedKey) {
  if (!map) return;
  layer.clearLayers();
  const pts = [];

  state.people.forEach((p, i) => {
    if (p.lat == null) return;
    L.marker([p.lat, p.lon], { icon: circleIcon(COLORS[i % COLORS.length], 16) })
      .bindPopup(esc(p.name || 'Person ' + (i + 1)))
      .addTo(layer);
    pts.push([p.lat, p.lon]);
  });

  if (state.center) {
    L.marker([state.center.lat, state.center.lon], { icon: circleIcon('transparent', 14, true) })
      .bindPopup('Midpoint').addTo(layer);
    pts.push([state.center.lat, state.center.lon]);
  }

  state.results.slice(0, 10).forEach(v => {
    const sel = v.key === selectedKey;
    L.marker([v.lat, v.lon], { icon: circleIcon(sel ? '#4FC98A' : '#7C8880', sel ? 14 : 9) })
      .bindPopup(esc(v.name)).addTo(layer);
    if (sel) pts.push([v.lat, v.lon]);
  });

  if (pts.length === 1) map.setView(pts[0], 13);
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25));
}

/* --------------------------------------------------------------- render */

function addPerson(name) {
  if (state.people.length >= MAX_PEOPLE) return;
  const id = uid();
  const p = { id, name: name || codename(id), lat: null, lon: null, label: '',
              flex: false, status: '', nameAuto: !name };
  state.people.push(p);
  return p;
}

/* A poll every 4 seconds must not rebuild these rows: recreating an <input>
   the user is typing in drops focus, closes the keyboard, and loses the
   characters typed since the last render. So rebuild only when the roster
   itself changes, and otherwise patch values in place — never touching a
   field that currently has focus. */
function renderPeople() {
  const host = $('#people');
  const signature = state.people.map(p => p.id).join(',') + '|' + state.people.length;

  if (host.dataset.sig === signature && host.children.length === state.people.length) {
    patchPeople();
    renderGroups();   // must run on the patch path too, or the save button
    return;           // never appears while someone is typing names in
  }
  host.dataset.sig = signature;
  host.innerHTML = '';

  state.people.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'person' + (p.id === state.me ? ' me' : '');
    row.dataset.id = p.id;
    row.innerHTML = `
      <span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>
      ${p.id === state.me ? '<span class="you-tag">You</span>' : ''}
      <div class="fields">
        <input type="text" class="nm" placeholder="Name" value="${esc(p.name)}">
        <div class="loc-row">
          <input type="text" class="lc" placeholder="Neighborhood or city"
                 value="${esc(p.label)}">
          <button class="mini loc">Locate</button>
        </div>
        <button class="flex-toggle${p.flex ? ' on' : ''}">
          ${p.flex ? '✓ Happy to travel further' : 'I can travel further'}
        </button>
        <div class="status ${p.status?.startsWith('!') ? 'err' : p.lat != null ? 'ok' : ''}">${
          esc(p.status?.replace(/^!/, '') || (p.lat != null ? 'Location set' : ''))}</div>
      </div>
      ${state.people.length > 1 && !isLive() ? '<button class="rm" title="Remove">&times;</button>' : ''}`;

    const who = () => state.people.find(x => x.id === row.dataset.id) || p;

    row.querySelector('.nm').addEventListener('input', e => {
      const t = who();

      // Clearing the field rolls another placeholder, so you can keep
      // clearing until one amuses you. It is selected, so typing a real name
      // replaces it rather than appending to it.
      if (!e.target.value.trim()) {
        t.nameSeed = (t.nameSeed || 0) + 1;
        t.name = codename(t.id + ':' + t.nameSeed);
        t.nameAuto = true;
        e.target.value = t.name;
        e.target.select();
        saveName('');
        syncURL();
        if (isLive() && t.id === Sync.me) Sync.push(t.name, t.label, t.lat, t.lon);
        return;
      }

      t.name = e.target.value;
      t.nameAuto = false;
      if (i === 0 || t.id === Sync.me) saveName(t.name.trim());
      syncURL();
      if (isLive() && t.id === Sync.me) Sync.push(t.name, t.label, t.lat, t.lon);
    });

    const lc = row.querySelector('.lc');
    // Mark the field the moment typing starts, not when it is committed: a
    // reverse lookup finishing mid-sentence used to replace what was being
    // typed, and the old guard only noticed a location already committed.
    lc.addEventListener('input', () => { who().locDirty = true; });

    lc.addEventListener('change', async () => {
      const t = who();
      t.locDirty = false;
      const q = lc.value.trim();
      if (!q) { t.lat = t.lon = null; t.label = ''; t.status = ''; refresh(); return; }
      t.status = 'Looking up…'; renderPeople();
      try {
        const hit = await geocode(q);
        if (!hit) { t.status = '!No match — try adding the city'; t.lat = t.lon = null; }
        else {
          t.lat = hit.lat; t.lon = hit.lon; t.label = hit.label;
          t.status = hit.label + ' — typed, not your current location';
        }
      } catch (e) {
        t.status = '!Lookup failed: ' + e.message;
      }
      if (isLive() && t.id === Sync.me) Sync.push(t.name, t.label, t.lat, t.lon);
      refresh();
    });

    row.querySelector('.loc').addEventListener('click', () => locate(who()));
    row.querySelector('.flex-toggle').addEventListener('click', () => {
      const t = who();
      t.flex = !t.flex;
      renderPeople(); syncURL();
      if (state.results.length) search();
    });
    row.querySelector('.rm')?.addEventListener('click', () => {
      if (isLive()) return;   // in a live session people join and leave themselves
      state.people = state.people.filter(x => x.id !== row.dataset.id);
      refresh();
    });

    host.appendChild(row);
  });

  $('#addPerson').disabled = state.people.length >= MAX_PEOPLE || isLive();
  renderGroups();
}

function renderGroups() {
  const host = $('#groups');
  if (!host) return;
  // Never rebuild over a form someone is filling in: a poll arriving mid-typing
  // used to close it.
  if (host.querySelector('.g-form')) return;
  const groups = loadGroups();
  const saveable = state.people.filter(p => p.name?.trim() || p.lat != null).length >= 2;

  host.innerHTML = '';
  host.hidden = !groups.length && !saveable;

  for (const g of groups) {
    const chip = document.createElement('div');
    chip.className = 'group-chip';
    chip.innerHTML =
      `<button class="g-load">${esc(g.name)}<span class="g-n">${g.people.length}</span></button>`
      + `<button class="g-del" aria-label="Delete ${esc(g.name)}">&times;</button>`;
    chip.querySelector('.g-load').addEventListener('click', () => applyGroup(g));
    chip.querySelector('.g-del').addEventListener('click', () => {
      storeGroups(loadGroups().filter(x => x.id !== g.id));
      renderGroups();
    });
    host.appendChild(chip);
  }

  if (saveable) {
    const b = document.createElement('button');
    b.className = 'chip g-save';
    b.id = 'saveGroup';
    b.textContent = groups.length ? 'Save this group' : 'Save these people as a group';
    b.addEventListener('click', beginSaveGroup);
    host.appendChild(b);
  }
}

function beginSaveGroup() {
  const host = $('#groups');
  const form = document.createElement('div');
  form.className = 'g-form';
  form.innerHTML =
    `<input type="text" class="g-name" maxlength="40" placeholder="Name this group"
            value="${esc(suggestGroupName(state.people))}">`
    + `<button class="mini accent g-ok">Save</button>`
    + `<button class="mini g-cancel">Cancel</button>`;
  host.replaceChildren(form);

  const input = form.querySelector('.g-name');
  input.focus(); input.select();

  const save = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const groups = loadGroups().filter(g => g.name.toLowerCase() !== name.toLowerCase());
    storeGroups([groupFromPeople(name, state.people), ...groups]);
    host.replaceChildren();          // the guard refuses to rebuild over a form
    renderGroups();
    log(`Saved “${name}”. Tap it next time instead of typing everyone in.`);
  };
  form.querySelector('.g-ok').addEventListener('click', save);
  const close = () => { host.replaceChildren(); renderGroups(); };
  form.querySelector('.g-cancel').addEventListener('click', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') close();
  });
}

function applyGroup(g) {
  if (isLive()) {
    log('People join a live session themselves — leave it first to load a group.');
    return;
  }
  state.people = g.people.map(p => {
    const id = uid();
    return {
    id, name: p.name || codename(id), nameAuto: !p.name, label: p.label || '',
    lat: p.lat ?? null, lon: p.lon ?? null, flex: !!p.flex,
    status: p.lat != null ? (p.label || 'Location set') : 'Tap Locate, or type a place'
  };});
  if (!state.people.length) addPerson();
  state.me = state.people[0].id;
  $('#people').dataset.sig = '';          // roster changed wholesale
  refresh();
  log(`Loaded “${g.name}”. Check everyone is still in the right place.`);
}

function patchPeople() {
  const rows = $('#people').children;
  state.people.forEach((p, i) => {
    const row = rows[i];
    if (!row) return;
    const nm = row.querySelector('.nm');
    const lc = row.querySelector('.lc');
    // Leave any field the user is in alone, whatever the server says.
    if (nm && document.activeElement !== nm && nm.value !== p.name) nm.value = p.name;
    if (lc && document.activeElement !== lc && lc.value !== (p.label || '')) lc.value = p.label || '';
    const ft = row.querySelector('.flex-toggle');
    if (ft) {
      const text = p.flex ? '✓ Happy to travel further' : 'I can travel further';
      if (ft.textContent.trim() !== text) ft.textContent = text;
      ft.classList.toggle('on', !!p.flex);
    }
    row.classList.toggle('me', p.id === state.me);
    const you = row.querySelector('.you-tag');
    if (!!you !== (p.id === state.me)) { $('#people').dataset.sig = ''; }

    const st = row.querySelector('.status');
    if (st) {
      const text = p.status?.replace(/^!/, '') || (p.lat != null ? 'Location set' : '');
      if (st.textContent !== text) st.textContent = text;
      st.className = 'status ' + (p.status?.startsWith('!') ? 'err' : p.lat != null ? 'ok' : '');
    }
  });
}

/* iOS never re-prompts once location is denied: every later call fails
   instantly with no dialog. So check the standing state up front and say what
   to do, instead of showing the same dead-end error over and over. */
async function checkGeoPermission() {
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' });
    if (!st) return;
    const apply = () => { state.geoBlocked = st.state === 'denied'; renderGeoHelp(); };
    apply();
    st.onchange = apply;                 // fires if they fix it in Settings
  } catch { /* Permissions API unavailable: we find out on first attempt */ }
}

/* Say it plainly when one person is too far for any spot to serve, and offer
   the two honest choices rather than silently picking one. */
function renderOutliers(located) {
  const el = $('#outlier');
  if (!el) return;
  const far = findOutliers(located);
  if (!far.length) { el.hidden = true; return; }
  el.hidden = false;
  const names = far.map(p => p.name?.trim() || 'Someone').join(' and ');
  el.innerHTML =
    `<b>${esc(names)} ${far.length > 1 ? 'are' : 'is'} far from everyone else.</b>`
    + `<p>Meeting in the middle would send the rest of the group a long way out. `
    + `You can keep it equal, or let ${esc(names)} take the longer trip.</p>`
    + `<div class="outlier-actions">
         <button class="mini" id="outlierFlex">Let ${esc(names)} travel further</button>
         <button class="mini" id="outlierEqual">Keep it equal for everyone</button>
       </div>`;
  $('#outlierFlex').addEventListener('click', () => {
    for (const p of far) p.flex = true;
    renderPeople(); syncURL(); search();
  });
  $('#outlierEqual').addEventListener('click', () => { el.hidden = true; });
}

/* Every failure the app can detect, said out loud in one place. Two sessions
   with a real tester were lost to problems the app knew about and did not
   mention: a write that failed, a permission already refused, a session that
   had expired. Silence is the worst possible error state — it looks like the
   app working. */
const TROUBLE = {
  write:    { text: 'Changes are not saving. Check your connection — anything typed may be lost.', fix: null },
  migration:{ text: 'The database is missing an update, so names and places will not save for other people.',
              fix: 'Run supabase/fix-002 in the Supabase SQL editor.' },
  geo:      { text: 'Location is blocked for this site, and iPhone will not ask again.',
              fix: 'Tap aA in the address bar → Website Settings → Location → Ask. Or type a neighborhood instead.' },
  expired:  { text: 'That session has expired. Sessions last 12 hours.',
              fix: 'Start a new one with Go live.' },
  offline:  { text: 'No connection.', fix: 'Suggestions and live updates need one.' }
};

function renderTrouble() {
  const el = $('#trouble');
  if (!el) return;
  const now = [];
  if (!navigator.onLine) now.push('offline');
  if (Sync?.needsMigration) now.push('migration');
  else if (Sync?.writeFailed) now.push('write');
  if (state.geoBlocked) now.push('geo');
  if (/expired|does not exist/i.test(state.liveErr || '')) now.push('expired');

  if (!now.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = now.map(k => {
    const t = TROUBLE[k];
    return `<div class="tr"><b>${esc(t.text)}</b>${t.fix ? `<span>${esc(t.fix)}</span>` : ''}</div>`;
  }).join('');
}

function renderGeoHelp() {
  const el = $('#geoHelp');
  if (!el) return;
  el.hidden = !state.geoBlocked;
  renderTrouble();
}

function locate(p) { return locateAsync(p).catch(() => {}); }

function locateAsync(p, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      p.status = '!This browser has no location support';
      renderPeople(); reject(new Error('unsupported')); return;
    }
    p.status = 'Getting your location…'; renderPeople();
    navigator.geolocation.getCurrentPosition(
      pos => {
        p.lat = pos.coords.latitude; p.lon = pos.coords.longitude;
        p.label = 'Locating…'; p.status = 'Found you — naming the area…';
        if (!p.name.trim()) p.name = savedName() || '';
        if (isLive() && p.id === Sync.me) Sync.push(p.name, p.label, p.lat, p.lon);
        else state.me = p.id;
        refresh();
        resolve(p);

        // Name the place after resolving, so the pin is not held up by it.
        const settle = (label, status) => {
          // Resolve the person again: a poll may have replaced the roster
          // while the lookup was in flight, and writing to the old object
          // would leave the row showing "Locating…" for good.
          const t = state.people.find(x => x.id === p.id) || p;
          if (t.label !== 'Locating…' || t.locDirty) return;   // being typed, or already set
          t.label = label; t.status = status;
          if (isLive() && t.id === Sync.me) Sync.push(t.name, t.label, t.lat, t.lon);
          renderPeople(); syncURL();
        };
        reverseGeocode(p.lat, p.lon)
          .then(name => name
            ? settle(name, 'You are near ' + name)
            : settle('My location', 'Using your current location'))
          .catch(() => settle('My location', 'Using your current location'));
      },
      err => {
        if (err.code === 1) { state.geoBlocked = true; renderGeoHelp(); }
        p.status = '!' + (err.code === 1
          ? 'Location blocked — type a neighborhood here instead'
          : 'Could not get location — type a neighborhood here instead');
        renderPeople();
        // Point them at the box that still works.
        const row = [...$('#people').children][state.people.indexOf(p)];
        row?.querySelector('.lc')?.focus();
        reject(err);
      },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

function renderLive() {
  const bar = $('#liveBar');
  if (!window.Sync?.configured) { bar.hidden = true; return; }
  bar.hidden = false;
  const live = isLive();
  $('#goLive').hidden = live;
  $('#joinLive').hidden = live;
  $('#liveOn').hidden = !live;
  if (live && !$('#liveCode').dataset.copied) $('#liveCode').textContent = Sync.code;
  const mine = state.people.find(p => p.id === Sync.me);
  $('#shareLoc').hidden = !(live && mine && mine.lat == null);

  renderTrouble();
  $('#liveNote').textContent = state.liveErr
    || (live ? 'Everyone in this session sees each other move. Expires in 12 hours.'
             : 'Start a live session and friends join by link — no copying state back and forth.');
  $('#liveNote').className = 'hint' + (state.liveErr ? ' err' : '');
}

/* In live mode the server owns the roster, so a poll replaces state.people.
   The one exception is the row you are editing: overwriting your own name
   mid-keystroke would fight your typing. */
function applyRemote(remote, err) {
  if (err || !remote) {
    state.liveErr = err ? err.message : 'Lost contact with the session.';
    renderLive();
    return;
  }
  state.liveErr = '';
  // Whatever is being typed right now wins over anything the server returns.
  const focusedRow = document.activeElement?.closest?.('.person');
  const focusedId = focusedRow ? state.people[[...$('#people').children].indexOf(focusedRow)]?.id : null;

  state.people = (remote.people || []).slice(0, MAX_PEOPLE).map(p => {
    const mine = p.id === Sync.me;
    const prev = state.people.find(x => x.id === p.id);
    const keepLocal = prev && p.id === focusedId;
    return {
      id: p.id,
      // Also keep a local name the server has not echoed yet: the push is in
      // flight, and accepting the stale empty value would wipe it.
      name: (keepLocal || (mine && prev?.name && !p.name))
              ? prev.name
              : (p.name || codename(p.id)),
      nameAuto: prev?.nameAuto ?? !p.name,
      lat: p.lat, lon: p.lon,
      label: (keepLocal && prev ? prev.label
              : (mine && prev?.label === 'Locating…' ? 'Locating…'
                 : (p.label || prev?.label || '')))
             || (p.lat != null ? 'Shared location' : ''),
      locDirty: prev?.locDirty || false,
      flex: prev?.flex || false,
      status: p.lat != null
        ? (mine ? 'You — on the map' : (p.label || 'On the map'))
        : (mine ? 'Tap Locate to add yourself' : 'Joined, no location shared yet')
    };
  });
  state.me = Sync.me;

  /* Two devices belonging to one person both recall the same saved name, so a
     session shows the same name twice. Whoever did not type it this session
     gives way to a placeholder. */
  const mineRow = state.people.find(p => p.id === Sync.me);
  if (mineRow?.nameAuto && mineRow.name &&
      state.people.some(p => p.id !== mineRow.id &&
                             p.name.trim().toLowerCase() === mineRow.name.trim().toLowerCase())) {
    mineRow.name = codename(mineRow.id);
    Sync.push(mineRow.name, mineRow.label, mineRow.lat, mineRow.lon);
  }

  state.votes = {};
  for (const v of (remote.votes || [])) {
    (state.votes[v.venue_key] ||= {})[v.participant_id] = v.dir;
  }
  const catsBefore = state.cats.join(',');
  if (Array.isArray(remote.cats) && remote.cats.length) state.cats = remote.cats;
  const changed = applyRemoteFilters(remote.filters) || state.cats.join(',') !== catsBefore;

  // Someone else searched: show their list rather than running our own.
  const adopted = remote.results_by !== Sync.me && adoptResults(remote.results);
  if (adopted) {
    const who = state.people.find(p => p.id === remote.results_by);
    log(`${who?.name || 'Someone'} searched — showing the same ${state.results.length} spots.`);
  }

  renderPeople(); renderCats(); renderLive(); drawMap();
  if (state.results.length) renderResults();

  // Someone changed the search: re-run it so everyone is looking at the same
  // list, rather than at whatever they last searched for themselves.
  if (adopted) { drawMap(state.results[0]?.key); renderResults(state.results[0]?.key); }

  // Only re-run when the settings moved and nobody has already searched for us.
  if (changed && state.results.length && !state.searching && !adopted) {
    log('Search settings changed by someone in the session — updating…');
    search();
  }
}

function renderCats() {
  const host = $('#cats');
  host.innerHTML = '';
  // The eight headline chips, plus anything picked from search so a chosen
  // category never disappears from view.
  const shown = [...new Set([...CHIP_CATS, ...state.cats])];
  for (const k of shown) {
    const c = CATS[k];
    if (!c) continue;
    const b = document.createElement('button');
    b.className = 'chip' + (state.cats.includes(k) ? ' on' : '');
    b.textContent = c.label;
    b.addEventListener('click', () => {
      state.cats = state.cats.includes(k)
        ? state.cats.filter(x => x !== k)
        : [...state.cats, k];
      if (!state.cats.length) state.cats = [k];
      state.lucky = false;            // an explicit choice ends lucky mode
      renderCats(); syncURL();
      pushPrefs();
    });
    host.appendChild(b);
  }

  // Cuisines are only interesting once someone is thinking about food, so
  // they stay out of the way until Food (or a cuisine) is selected.
  const foodish = state.cats.includes('food') || state.cats.some(c => CUISINES.includes(c));
  if (foodish) {
    const sub = document.createElement('div');
    sub.className = 'subchips';
    for (const id of CUISINES) {
      const c = CATS[id];
      const b = document.createElement('button');
      b.className = 'chip sub' + (state.cats.includes(id) ? ' on' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => {
        const on = state.cats.includes(id);
        // A cuisine narrows Food, so the two cannot both apply: "restaurants
        // OR pizza places" is just "restaurants".
        state.cats = on ? state.cats.filter(x => x !== id)
                        : [...state.cats.filter(x => x !== 'food'), id];
        if (!state.cats.some(x => CUISINES.includes(x)) && !state.cats.includes('food')) {
          state.cats = [...state.cats, 'food'];
        }
        state.lucky = false;
        renderCats(); syncURL();
        pushPrefs();
      });
      sub.appendChild(b);
    }
    host.appendChild(sub);
  }

  renderCatSearch();

  const lucky = document.createElement('button');
  lucky.className = 'chip lucky' + (state.lucky ? ' on' : '');
  lucky.id = 'lucky';
  lucky.textContent = state.lucky ? 'Re-roll' : 'Surprise us';
  lucky.addEventListener('click', rollLucky);
  host.appendChild(lucky);
}

function renderCatSearch(q) {
  const host = $('#catResults');
  const query = q ?? $('#catSearch').value;
  host.innerHTML = '';

  // An empty box with the cursor in it should show what there is to choose
  // from. Making people guess the right word is a worse search box.
  if (!query.trim()) {
    if (document.activeElement !== $('#catSearch')) { host.hidden = true; return; }
    host.hidden = false;
    host.appendChild(catRow(CATALOG, 'Everything'));
    return;
  }

  const hits = searchCats(query);
  host.hidden = false;

  if (!hits.length) {
    host.innerHTML = `<div class="no-cat">Nothing matches “${esc(query.trim())}”. `
      + `Try a broader word — “drinks”, “food”, “outdoors”.</div>`;
    return;
  }

  host.appendChild(catRow(hits));
}

function catRow(list, heading) {
  const frag = document.createDocumentFragment();
  if (heading) {
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = heading;
    frag.appendChild(h);
  }
  for (const c of list) {
    const on = state.cats.includes(c.id);
    const b = document.createElement('button');
    b.className = 'cat-hit' + (on ? ' on' : '');
    b.innerHTML = `<span>${esc(c.label)}</span>` + (on ? '<span class="tick">✓</span>' : '');
    b.addEventListener('mousedown', e => e.preventDefault());   // keep focus
    b.addEventListener('click', () => {
      state.cats = on ? state.cats.filter(x => x !== c.id) : [...state.cats, c.id];
      if (!state.cats.length) state.cats = [c.id];
      state.lucky = false;
      if (!on) $('#catSearch').value = '';
      renderCats(); syncURL(); pushPrefs();
    });
    frag.appendChild(b);
  }
  return frag;
}

/* A search already computes travel times for everyone in the session, so its
   result belongs to the group rather than to whoever tapped the button.
   Sharing it keeps everybody on one list — two people voting on different
   lists was the quiet failure — and halves the calls to the free services. */
function shareResults(located) {
  Sync.results({
    at: state.resultsAt,
    people: located.map(p => p.id),
    together: state.together,
    estimated: state.estimated,
    travel: state.travel,
    venues: state.results.slice(0, MAX_VENUES).map(v => ({
      key: v.key, name: v.name, kind: v.kind, lat: v.lat, lon: v.lon,
      open: v.open, hours: v.hours, price: v.price, chain: v.chain,
      costs: v.costs.map(c => Math.round(c))
    }))
  });
}

/* Adopt someone else's search. Costs are stored against the ids they were
   computed for, so they are re-mapped onto the current roster rather than
   trusted by position. */
function adoptResults(r) {
  if (!r || !Array.isArray(r.venues) || !r.venues.length) return false;
  if (r.at && state.resultsAt && r.at <= state.resultsAt) return false;

  const idx = new Map((r.people || []).map((id, i) => [id, i]));
  state.results = r.venues.map(v => ({
    ...v,
    costs: state.people.map(p => {
      const i = idx.get(p.id);
      return i == null ? null : v.costs[i];
    })
  })).filter(v => v.costs.some(c => c != null));

  // Someone who joined after the search has no time of their own yet.
  for (const v of state.results) {
    const known = v.costs.filter(c => c != null);
    v.mean = known.reduce((a, b) => a + b, 0) / (known.length || 1);
    v.spread = known.length ? Math.max(...known) - Math.min(...known) : 0;
  }
  state.together = !!r.together;
  state.estimated = !!r.estimated;
  state.resultsAt = r.at || Date.now();
  return true;
}

/* Everything that shapes a search travels with the session, not just the
   categories. Otherwise one person sets "Tuesday 6pm, walking, no chains",
   searches, and everyone else is quietly looking at different results. */
function currentFilters() {
  return { travel: state.travel, when: state.when, whenTime: state.whenTime,
           noChains: state.noChains, maxPrice: state.maxPrice };
}

function pushPrefs() {
  if (isLive()) Sync.prefs(state.cats, currentFilters());
}

function applyRemoteFilters(f) {
  if (!f || typeof f !== 'object') return false;
  const before = JSON.stringify(currentFilters());
  if (typeof f.travel === 'string')   state.travel = f.travel === 'walk' ? 'walk' : 'drive';
  if (typeof f.when === 'string')     state.when = f.when;
  if (typeof f.whenTime === 'string') state.whenTime = f.whenTime;
  if (typeof f.noChains === 'boolean')state.noChains = f.noChains;
  if (typeof f.maxPrice === 'string') state.maxPrice = f.maxPrice;
  if (JSON.stringify(currentFilters()) === before) return false;

  $('#travel').value = state.travel;
  $('#whenDay').value = state.when;
  $('#whenTime').value = state.whenTime;
  $('#whenTime').hidden = !/^[0-6]$/.test(state.when);
  $('#noChains').classList.toggle('on', state.noChains);
  $('#price').value = state.maxPrice;
  return true;
}

/* Choosing a maps app is a decision about the tap you are making right now,
   not a setting to configure beforehand. Asking here costs one tap, removes a
   control from the page, and still remembers what you picked last. */
function openMapsSheet(v) {
  const sheet = $('#mapsSheet');
  $('#msTitle').textContent = `Open ${v.name} in`;
  const last = mapsPref();
  for (const a of sheet.querySelectorAll('.ms-opt')) {
    a.href = mapsUrl(v, a.dataset.app);
    a.classList.toggle('last', a.dataset.app === last);
    a.onclick = () => { setMapsPref(a.dataset.app); closeMapsSheet(); };
  }
  sheet.hidden = false;
  sheet.querySelector(`.ms-opt.last`)?.focus();
}

function closeMapsSheet() { $('#mapsSheet').hidden = true; }

/* Pick a few activity types at random and search straight away. Re-rolling
   picks a different set, so tapping twice never gives the same answer. */
function rollLucky() {
  const keys = CATALOG.filter(c => c.lucky).map(c => c.id);
  const next = pickRandom(keys, LUCKY_CATS);
  // Never re-roll into the identical set — a re-roll that changes nothing
  // reads as a broken button.
  state.cats = (state.lucky && next.every(k => state.cats.includes(k)))
    ? pickRandom(keys.filter(k => !state.cats.includes(k)), LUCKY_CATS)
    : next;
  state.lucky = true;
  renderCats(); syncURL(); pushPrefs();
  search();
}

function tally(key) {
  const v = state.votes[key] || {};
  let up = 0, down = 0;
  for (const val of Object.values(v)) val > 0 ? up++ : down++;
  return { up, down };
}

/* A thumbs-down is a veto. "Not there, it's terrible" is the commonest thing
   anyone says while choosing, and one objection is usually enough. */
const isVetoed = key => tally(key).down > 0;

/* Once everyone with a location has voted, the group has decided. Announcing
   it gives the session an ending, which it otherwise lacks. */
function winner() {
  const voters = new Set();
  for (const v of Object.values(state.votes)) for (const id of Object.keys(v)) voters.add(id);
  const present = state.people.filter(p => p.lat != null);
  if (present.length < 2 || !present.every(p => voters.has(p.id))) return null;

  const live = state.results.filter(v => !isVetoed(v.key) && tally(v.key).up > 0);
  if (!live.length) return null;
  return live.reduce((a, b) => (tally(b.key).up > tally(a.key).up ? b : a));
}

function renderResults(selectedKey) {
  const host = $('#results');
  host.innerHTML = '';
  if (!state.results.length) return;

  const vetoed = state.results.filter(v => isVetoed(v.key));
  let shown = state.showVetoed ? state.results : state.results.filter(v => !isVetoed(v.key));

  /* Anything anyone likes rises to the top, on every device. A vote that only
     changed a tally was decoration; this is the group actually narrowing
     things down together. */
  const liked = shown.filter(v => tally(v.key).up > 0)
                     .sort((a, b) => tally(b.key).up - tally(a.key).up || a.score - b.score);
  const rest = shown.filter(v => tally(v.key).up === 0);
  shown = [...liked, ...rest];

  if (liked.length) {
    const h = document.createElement('div');
    h.className = 'shortlist-head';
    h.innerHTML = `<b>Shortlist</b><span>${liked.length} liked by someone in the group</span>`;
    host.appendChild(h);
  }

  const win = winner();
  if (win) {
    const b = document.createElement('div');
    b.className = 'winner';
    b.innerHTML = `<b>${esc(win.name)}</b>`
      + `<p>Everyone has voted. ${tally(win.key).up} in favour.</p>`
      + `<button class="maplink" data-venue="${esc(win.key)}">Directions ↗</button>`;
    host.appendChild(b);
  }

  const worst = Math.max(...state.results.flatMap(v => v.costs));
  const unit = fmtMin;
  const approx = state.estimated ? '~' : '';

  shown.slice(0, 10).forEach((v, i) => {
    const t = tally(v.key);
    const myVote = (state.votes[v.key] || {})[state.me];
    const card = document.createElement('div');
    if (liked.length && i === liked.length) {
      const h = document.createElement('div');
      h.className = 'shortlist-head rest';
      h.innerHTML = `<b>Everything else</b>`;
      host.appendChild(h);
    }
    card.className = 'venue' + (v.key === selectedKey ? ' sel' : '')
                   + (tally(v.key).up > 0 ? ' liked' : '')
                   + (isVetoed(v.key) ? ' vetoed' : '')
                   + (win && v.key === win.key ? ' won' : '');

    const at = whenLabel() || 'now';
    const openPill = v.open === true ? `<span class="pill good">Open ${esc(at)}</span>`
                   : v.open === false ? `<span class="pill bad">Closed ${esc(at)}</span>`
                   : '<span class="pill">Hours unknown</span>';
    const pricePill = v.price ? `<span class="pill">${'$'.repeat(v.price)}</span>` : '';
    const chainPill = v.chain ? '<span class="pill warn">Chain</span>' : '';

    card.innerHTML = `
      <div class="vhead">
        <span class="rank">${i + 1}</span>
        <span class="vname">${esc(v.name)}</span>
        <span class="vkind">${esc(v.kind.replace(/_/g, ' '))}</span>
      </div>
      <div class="vmeta">
        <span class="pill">avg ${approx}${unit(v.mean)}</span>
        <span class="pill ${v.spread < 300 ? 'good' : v.spread < 600 ? 'warn' : ''}">±${approx}${unit(v.spread)} spread</span>
        ${openPill}${pricePill}${chainPill}
      </div>
      ${state.together ? `
      <div class="fair one">
        <span class="nm">Everyone</span>
        <span class="bar"><i style="width:100%;background:var(--accent)"></i></span>
        <span class="tm">${approx}${unit(v.mean)}</span>
      </div>` : `
      <div class="fair">${state.people.map((p, pi) => `
        <div class="fairrow">
          <span class="nm">${esc(p.name || 'P' + (pi + 1))}</span>
          <span class="bar"><i style="width:${Math.max(4, 100 * v.costs[pi] / worst)}%;background:${COLORS[pi % COLORS.length]}"></i></span>
          <span class="tm">${approx}${unit(v.costs[pi])}</span>
        </div>`).join('')}
      </div>`}
      <div class="vactions">
        <button class="vote up ${myVote > 0 ? 'on' : ''}" title="Up for it">Yes</button>
        <button class="vote down ${myVote < 0 ? 'on' : ''}" title="Rule it out">No</button>
        <button class="maplink" data-venue="${esc(v.key)}">Directions ↗</button>
        <span class="tally">${t.up}&nbsp;yes&nbsp;&nbsp;${t.down}&nbsp;no</span>
      </div>`;

    card.addEventListener('click', e => {
      if (e.target.closest('.vote') || e.target.closest('a')) return;
      if (e.target.closest('.maplink')) { openMapsSheet(v); return; }
      drawMap(v.key); renderResults(v.key);
    });
    card.querySelector('.vote.up').addEventListener('click', () => vote(v.key, 1));
    card.querySelector('.vote.down').addEventListener('click', () => vote(v.key, -1));
    host.appendChild(card);
  });

  if (vetoed.length) {
    const v = document.createElement('button');
    v.className = 'vetoed-toggle';
    v.textContent = state.showVetoed
      ? `Hide the ${vetoed.length} ruled out`
      : `${vetoed.length} ruled out — show anyway`;
    v.addEventListener('click', () => {
      state.showVetoed = !state.showVetoed;
      renderResults(selectedKey);
    });
    host.appendChild(v);
  }

  if (!isLive()) {
    const note = document.createElement('div');
    note.className = 'note';
    note.innerHTML = 'Votes and everyone’s pins live in the link, not on a server. '
      + 'Tap <b>Copy invite link</b> after voting and send it back so the group sees your picks.';
    host.appendChild(note);
  }
}

function vote(key, dir) {
  if (!state.me) state.me = state.people[0]?.id;
  if (!state.me) return;
  state.votes[key] = state.votes[key] || {};
  if (state.votes[key][state.me] === dir) delete state.votes[key][state.me];
  else state.votes[key][state.me] = dir;
  if (!Object.keys(state.votes[key]).length) delete state.votes[key];
  syncURL();
  if (isLive()) Sync.vote(key, state.votes[key]?.[state.me] ?? 0);
  renderResults(key);
}

/* --------------------------------------------------------------- search */

async function search() {
  if (state.searching) return;
  state.searching = true;
  const located = state.people.filter(p => p.lat != null);
  if (!located.length) { log('Add at least one location first.'); return; }

  $('#find').disabled = true;
  state.results = [];
  renderResults();

  try {
    const center = centroid(located);
    state.center = center;

    const walking = state.travel === 'walk';
    const maxFromCenter = Math.max(...located.map(p => haversine(p, center)), 0);
    // Already together: search wider, because the question is no longer who
    // travels but what is worth walking out to.
    const together = located.length > 1 && maxFromCenter < TOGETHER_M;
    state.together = together;
    const floor = together ? TOGETHER_RADIUS[state.travel] : (walking ? 600 : 1500);
    const radius = Math.min(MAX_RADIUS[state.travel], Math.max(floor, maxFromCenter * 0.45));

    log('Searching OpenStreetMap near the midpoint…', true);
    let venues = await fetchVenues(center, radius);

    // Open-now filter never drops venues with unknown hours; that would hide
    // most of the map, since opening_hours coverage in OSM is partial.
    let chainsHidden = 0;
    if (state.noChains) {
      const indie = venues.filter(v => !v.chain);
      chainsHidden = venues.length - indie.length;
      // Somewhere that is *only* chains should still get an answer, with a
      // note, rather than an empty list that looks like a broken search.
      if (indie.length) venues = indie;
      else if (venues.length) chainsHidden = -1;
    }
    const at = whenDate();
    for (const v of venues) v.open = isOpenNow(v.hours, at || new Date());
    if (at) venues = venues.filter(v => v.open !== false);
    if (state.maxPrice) venues = venues.filter(v => v.price == null || v.price <= +state.maxPrice);

    if (!venues.length) {
      log('No matching spots nearby. Try more activity types or a wider group.');
      state.results = []; drawMap(); renderResults();
      return;
    }

    // Pre-trim by straight-line fairness so the matrix call stays small.
    venues = scoreVenues(venues, located, null, SPEED[state.travel]).slice(0, MAX_VENUES);

    let matrix = null;
    log(`Getting ${walking ? 'walking' : 'drive'} times for ${located.length} × ${venues.length} pairs…`, true);
    try {
      matrix = await driveTimes(located, venues, walking ? 'foot' : 'driving');
    } catch {
      // Not a user-visible mode: distance stands in for time until OSRM returns,
      // and every figure is marked "~" so an estimate never reads as measured.
      log(`${walking ? 'Walking' : 'Drive'}-time service unavailable — showing distance-based estimates.`);
    }

    state.results = scoreVenues(venues, located, matrix, SPEED[state.travel]);
    state.estimated = !matrix;
    renderOutliers(located);

    if (state.lucky) {
      // Shuffle within the fairest handful rather than across everything:
      // a "random" pick that is 40 minutes from one person defeats the point.
      const pool = state.results.slice(0, LUCKY_POOL);
      state.results = shuffle(pool).concat(state.results.slice(LUCKY_POOL));
      const picked = state.cats.map(c => CATS[c]?.label.replace(/^\S+\s/, '')).join(', ');
      log(`${picked} — shuffled from the ${pool.length} fairest. Re-roll for another.`);
    }
    else if (chainsHidden === -1)
      log(`Only chains near this midpoint — showing them anyway.`);
    else if (together)
      log(`You're all in the same place — ${state.results.length} spots near you, nearest first.`);
    else if (matrix)
      log(`${state.results.length} spots, ranked by real ${walking ? 'walking' : 'drive'} time.`
          + (chainsHidden ? ` ${chainsHidden} chain${chainsHidden > 1 ? 's' : ''} hidden.` : ''));
    else { /* fallback message already set */ }

    state.resultsAt = Date.now();
    if (isLive()) shareResults(located);

    drawMap(state.results[0]?.key);
    renderResults(state.results[0]?.key);
    syncURL();
  } catch (e) {
    log('Search failed: ' + e.message);
  } finally {
    state.searching = false;
    $('#find').disabled = false;
  }
}

/* ------------------------------------------------------------------ init */

function refresh() {
  renderPeople();
  drawMap();
  syncURL();
}

function boot() {
  initMap();

  const restored = location.hash.length > 1 && decodeState(location.hash.slice(1));
  if (!restored || !state.people.length) {
    addPerson(savedName()); addPerson();
  }
  if (!state.me) state.me = state.people[0].id;

  $('#noChains').classList.toggle('on', state.noChains);
  $('#travel').value = state.travel;
  $('#whenDay').value = state.when;
  $('#whenTime').value = state.whenTime;
  $('#whenTime').hidden = !/^[0-6]$/.test(state.when);
  $('#price').value = state.maxPrice;

  renderPeople();
  renderCats();
  drawMap();
  checkGeoPermission();
  renderTrouble();
  addEventListener('online', renderTrouble);
  addEventListener('offline', renderTrouble);

  $('#addPerson').addEventListener('click', () => { addPerson(); refresh(); });

  $('#travel').addEventListener('change', e => {
    state.travel = e.target.value;
    syncURL(); pushPrefs();
    if (state.results.length) search();
  });

  $('#catSearch').addEventListener('input', e => renderCatSearch(e.target.value));
  $('#mapsSheet').querySelector('.ms-backdrop').addEventListener('click', closeMapsSheet);
  $('#mapsSheet').querySelector('.ms-cancel').addEventListener('click', closeMapsSheet);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#mapsSheet').hidden) closeMapsSheet();
  });

  $('#catSearch').addEventListener('focus', () => renderCatSearch());
  $('#catSearch').addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== $('#catSearch') && !$('#catSearch').value.trim()) {
      $('#catResults').hidden = true;
    }
  }, 150));
  $('#catSearch').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.target.value = ''; renderCatSearch(''); }
    if (e.key === 'Enter')  { e.preventDefault(); $('#catResults .cat-hit')?.click(); }
  });

  wireLive();
  $('#find').addEventListener('click', search);

  $('#noChains').addEventListener('click', e => {
    state.noChains = !state.noChains;
    e.currentTarget.classList.toggle('on', state.noChains);
    syncURL(); pushPrefs();
  });
  $('#whenDay').addEventListener('change', e => {
    state.when = e.target.value;
    $('#whenTime').hidden = !/^[0-6]$/.test(state.when);
    syncURL(); pushPrefs();
  });
  $('#whenTime').addEventListener('change', e => {
    state.whenTime = e.target.value || '19:00';
    syncURL(); pushPrefs();
  });
  $('#price').addEventListener('change', e => { state.maxPrice = e.target.value; syncURL(); pushPrefs(); });

  $('#share').addEventListener('click', async () => {
    syncURL();
    const url = isLive() ? Sync.shareURL() : location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'Midpoint', url });
      else { await navigator.clipboard.writeText(url); log('Invite link copied.'); }
    } catch { /* user dismissed the share sheet */ }
  });

  if (restored && state.people.some(p => p.lat != null)) {
    log('Session loaded. Tap Locate on your row to add yourself.');
  }
}

function myRow() {
  return state.people.find(p => p.id === Sync.me) || state.people[0];
}

function wireLive() {
  if (!window.Sync?.init(window.MIDPOINT_CONFIG)) { renderLive(); return; }
  Sync.onState = applyRemote;
  Sync.onWriteError = () => {
    renderLive();     // the banner says what is wrong and how to fix it
  };

  $('#goLive').addEventListener('click', async () => {
    const me = myRow();
    $('#goLive').disabled = true;

    // Put yourself on the map before anyone joins: an empty map after tapping
    // Go live reads as a failure, even though the session was created fine.
    if (me && !me.name.trim()) {
      me.name = savedName() || codename(me.id); me.nameAuto = !savedName();
      renderPeople();
    }
    if (me && me.lat == null && !me.locDirty) {
      log('Getting your location…', true);
      try { await locateAsync(me); }
      catch { /* denied or unavailable — go live anyway, the row says why */ }
    }

    try {
      await Sync.create(me?.name || 'Me', me?.label || '', me?.lat ?? null, me?.lon ?? null);
      state.liveErr = '';
      setSessionParam(Sync.code);
      log(me?.lat != null
        ? 'You are on the map. Send the invite link to your friends.'
        : 'Live session started — tap Locate to put yourself on the map.');
    } catch (e) {
      state.liveErr = e.message;
    }
    $('#goLive').disabled = false;
    renderLive();
  });

  $('#joinLive').addEventListener('click', async () => {
    const code = prompt('Session code?');
    if (code) await joinSession(code.trim().toLowerCase());
  });

  $('#liveCode').addEventListener('click', () => copyCode());

  $('#shareLoc').addEventListener('click', async () => {
    const me = myRow();
    if (!me) return;
    try {
      await locateAsync(me);
      await Sync.push(me.name, me.label, me.lat, me.lon);
      log('You are on the map.');
    } catch {
      log('Location is blocked for this site. Allow it in Safari settings, or type a place above.');
    }
    renderLive();
  });

  $('#endLive').addEventListener('click', async () => {
    await Sync.leave();
    setSessionParam(null);
    state.people = state.people.filter(p => p.id === state.me);
    if (!state.people.length) addPerson();
    log('Left the session.');
    refresh(); renderLive();
  });

  // Auto-join when opened from a shared link.
  const code = new URLSearchParams(location.search).get('s');
  if (code) joinSession(code.trim().toLowerCase(), true);
  renderLive();
}

/* Tapping the code copies it. The clipboard API needs a secure context and
   can still be refused, so fall back to a selection-based copy and, failing
   both, leave the text selected for a manual copy. */
async function copyCode() {
  const el = $('#liveCode');
  if (!Sync.code) return;
  let done = false;
  try {
    await navigator.clipboard.writeText(Sync.code);
    done = true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = Sync.code;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-100px';
      document.body.appendChild(ta);
      ta.select();
      done = document.execCommand('copy');
      ta.remove();
    } catch { /* fall through to selecting the text */ }
  }
  if (done) {
    el.dataset.copied = '1';
    el.textContent = 'Copied!';
    clearTimeout(copyCode._t);
    copyCode._t = setTimeout(() => {
      delete el.dataset.copied;
      el.textContent = Sync.code || '';
    }, 1200);
  } else {
    getSelection()?.selectAllChildren(el);
  }
}

async function joinSession(code, fromLink) {
  const me = myRow();
  try {
    // Refreshing a shared link must not add another copy of you.
    const resumed = await Sync.resume(code).catch(() => null);
    if (resumed) {
      state.liveErr = '';
      setSessionParam(code);
      applyRemote(resumed);
      log('Back in the session.');
      renderLive();
      return;
    }

    await Sync.join(code, me?.name || savedName() || '', me?.label || '', me?.lat ?? null, me?.lon ?? null);
    state.liveErr = '';
    setSessionParam(code);

    // Joining is the same promise as going live — that you land on the map.
    // Without this the joiner sits in the session invisibly, waiting to notice
    // a Locate button they have no reason to look for.
    if (me && me.lat == null && !me.locDirty) {
      // Show the manual button straight away rather than only after the
      // automatic attempt fails — a dismissed prompt otherwise looks like a
      // dead end for several seconds.
      renderPeople(); renderLive();
      log('Joined. Sharing your location, or tap “Share my location”…', true);
      try {
        await locateAsync(me, 6000);
        await Sync.push(me.name, me.label, me.lat, me.lon);
        log('You are on the map.');
      } catch {
        // Declined or unavailable: the Share my location button takes over.
        log('Joined. Tap “Share my location” so the others can see you.');
      }
    } else {
      log('Joined the session.');
      if (me) await Sync.push(me.name, me.label, me.lat, me.lon);
    }
  } catch (e) {
    state.liveErr = e.message;
  }
  renderPeople(); renderLive();
}

/* There is deliberately no pagehide cleanup. On iOS that event also fires when
   the page is merely backgrounded — switching apps to reply to a text would
   silently remove you from the meetup. Leaving is explicit, and sessions expire
   after 12 hours regardless. */

document.addEventListener('DOMContentLoaded', boot);
