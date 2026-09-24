/* Midpoint — fair meetup spots for up to 4 people.
   Zero backend, zero API keys, zero cost.
   Data: OpenStreetMap (Nominatim geocoding, Overpass places) + OSRM (drive times). */

'use strict';

const MAX_PEOPLE = 8;
const MAX_VENUES = 25;            // also caps the OSRM matrix URL length
const COLORS = ['#4f9cf9', '#3fbf7f', '#f0b429', '#ef5f5f',
                '#a78bfa', '#2dd4bf', '#f472b6', '#fb923c'];
const LUCKY_CATS = 3;    // how many activity types a roll picks
const LUCKY_POOL = 12;   // shuffle within this many of the fairest spots

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/table/v1/driving/';

/* Category -> OpenStreetMap tag filters. */
const CATS = {
  coffee:  { label: '☕ Coffee',   tags: ['amenity=cafe'] },
  food:    { label: '🍽 Food',     tags: ['amenity=restaurant'] },
  drinks:  { label: '🍺 Drinks',   tags: ['amenity=bar', 'amenity=pub', 'amenity=biergarten'] },
  parks:   { label: '🌳 Parks',    tags: ['leisure=park', 'leisure=garden'] },
  culture: { label: '🎨 Culture',  tags: ['tourism=museum', 'tourism=gallery', 'amenity=theatre'] },
  active:  { label: '🎳 Active',   tags: ['leisure=bowling_alley', 'leisure=sports_centre', 'leisure=fitness_centre'] },
  music:   { label: '🎶 Music',    tags: ['amenity=nightclub', 'amenity=music_venue'] },
  books:   { label: '📚 Books',    tags: ['shop=books', 'amenity=library'] }
};

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
  liveErr: ''
};

const isLive = () => window.Sync?.live;

/* Browsers deliberately do not expose the device name, so the best we can do
   is remember what you called yourself last time. Storage can throw in private
   browsing, so every access is guarded. */
const NAME_KEY = 'midpoint.name';
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
                              p.lon == null ? null : +p.lon.toFixed(5), p.label || '']),
    c: state.cats, w: state.when, wt: state.whenTime, r: state.maxPrice,
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
      id: a[0], name: a[1] || '', lat: a[2], lon: a[3], label: a[4] || '', status: ''
    }));
    state.cats    = Array.isArray(d.c) && d.c.length ? d.c : ['coffee'];
    // `o` is the old open-now boolean from links made before this control.
    state.when     = d.w !== undefined ? String(d.w) : (d.o ? 'now' : '');
    state.whenTime = d.wt || '19:00';
    state.maxPrice = d.r || '';
    state.lucky   = !!d.l;
    // Absent in links made before this filter existed; default it on.
    state.noChains = d.n === undefined ? true : !!d.n;
    state.votes   = d.v && typeof d.v === 'object' ? d.v : {};
    return true;
  } catch { return false; }
}

function syncURL() {
  history.replaceState(null, '', '#' + encodeState());
}

/* ------------------------------------------------------------- geocoding */

const geoCache = new Map();

async function geocode(q) {
  const key = q.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key);

  const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Geocoder returned ' + res.status);
  const hits = await res.json();
  if (!hits.length) return null;

  const out = {
    lat: parseFloat(hits[0].lat),
    lon: parseFloat(hits[0].lon),
    label: hits[0].display_name.split(',').slice(0, 2).join(',').trim()
  };
  geoCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------- overpass */

function overpassQuery(center, radiusM) {
  const sel = [];
  for (const c of state.cats) {
    for (const t of (CATS[c]?.tags || [])) {
      const [k, v] = t.split('=');
      sel.push(`nwr["${k}"="${v}"](around:${Math.round(radiusM)},${center.lat.toFixed(5)},${center.lon.toFixed(5)});`);
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

async function driveTimes(people, venues) {
  const coords = [...people, ...venues]
    .map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const sources = people.map((_, i) => i).join(';');
  const dests = venues.map((_, i) => i + people.length).join(';');
  const url = `${OSRM}${coords}?sources=${sources}&destinations=${dests}&annotations=duration`;

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

function scoreVenues(venues, people, matrix) {
  return venues.map((v, vi) => {
    const costs = people.map((p, pi) => {
      if (matrix) return matrix[pi][vi];
      return haversine(p, v) / 13.4;                    // ~30 mph fallback estimate
    });
    if (costs.some(c => c == null || !Number.isFinite(c))) return null;
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const spread = Math.max(...costs) - Math.min(...costs);
    return { ...v, costs, mean, spread, score: mean + SPREAD_WEIGHT * spread };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
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
    html: `<div class="pin" style="width:${size}px;height:${size}px;background:${color};${ring ? 'border-color:#e8ecf3' : ''}"></div>`,
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
    L.marker([state.center.lat, state.center.lon], { icon: circleIcon('#e8ecf3', 12, true) })
      .bindPopup('Midpoint').addTo(layer);
    pts.push([state.center.lat, state.center.lon]);
  }

  state.results.slice(0, 10).forEach(v => {
    const sel = v.key === selectedKey;
    L.marker([v.lat, v.lon], { icon: circleIcon(sel ? '#4f9cf9' : '#8a93a5', sel ? 14 : 9) })
      .bindPopup(esc(v.name)).addTo(layer);
    if (sel) pts.push([v.lat, v.lon]);
  });

  if (pts.length === 1) map.setView(pts[0], 13);
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25));
}

/* --------------------------------------------------------------- render */

function addPerson(name) {
  if (state.people.length >= MAX_PEOPLE) return;
  const p = { id: uid(), name: name || '', lat: null, lon: null, label: '', status: '' };
  state.people.push(p);
  return p;
}

function renderPeople() {
  const host = $('#people');
  host.innerHTML = '';

  state.people.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'person';
    row.innerHTML = `
      <span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>
      <div class="fields">
        <input type="text" class="nm" placeholder="Name" value="${esc(p.name)}">
        <div class="loc-row">
          <input type="text" class="lc" placeholder="Neighborhood or city"
                 value="${esc(p.label)}">
          <button class="mini loc">Locate</button>
        </div>
        <div class="status ${p.status?.startsWith('!') ? 'err' : p.lat != null ? 'ok' : ''}">${
          esc(p.status?.replace(/^!/, '') || (p.lat != null ? 'Location set' : ''))}</div>
      </div>
      ${state.people.length > 1 && !isLive() ? '<button class="rm" title="Remove">&times;</button>' : ''}`;

    row.querySelector('.nm').addEventListener('input', e => {
      p.name = e.target.value;
      if (i === 0 || p.id === Sync.me) saveName(p.name.trim());
      syncURL();
      if (isLive() && p.id === Sync.me) Sync.push(p.name, p.lat, p.lon);
    });

    const lc = row.querySelector('.lc');
    lc.addEventListener('change', async () => {
      const q = lc.value.trim();
      if (!q) { p.lat = p.lon = null; p.label = ''; p.status = ''; refresh(); return; }
      p.status = 'Looking up…'; renderPeople();
      try {
        const hit = await geocode(q);
        if (!hit) { p.status = '!No match — try adding the city'; p.lat = p.lon = null; }
        else { p.lat = hit.lat; p.lon = hit.lon; p.label = hit.label; p.status = hit.label; }
      } catch (e) {
        p.status = '!Lookup failed: ' + e.message;
      }
      if (isLive() && p.id === Sync.me) Sync.push(p.name, p.lat, p.lon);
      refresh();
    });

    row.querySelector('.loc').addEventListener('click', () => locate(p));
    row.querySelector('.rm')?.addEventListener('click', () => {
      if (isLive()) return;   // in a live session people join and leave themselves
      state.people = state.people.filter(x => x.id !== p.id);
      refresh();
    });

    host.appendChild(row);
  });

  $('#addPerson').disabled = state.people.length >= MAX_PEOPLE || isLive();
}

function locate(p) { return locateAsync(p).catch(() => {}); }

function locateAsync(p) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      p.status = '!This browser has no location support';
      renderPeople(); reject(new Error('unsupported')); return;
    }
    p.status = 'Getting your location…'; renderPeople();
    navigator.geolocation.getCurrentPosition(
      pos => {
        p.lat = pos.coords.latitude; p.lon = pos.coords.longitude;
        p.label = 'My location'; p.status = 'Using your current location';
        if (isLive() && p.id === Sync.me) Sync.push(p.name, p.lat, p.lon);
        else state.me = p.id;
        refresh();
        resolve(p);
      },
      err => {
        p.status = '!' + (err.code === 1
          ? 'Location permission denied — type a place instead'
          : 'Could not get location — type a place instead');
        renderPeople(); reject(err);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
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
  const editing = document.activeElement?.closest?.('.person');
  const mineIdx = state.people.findIndex(p => p.id === Sync.me);

  state.people = (remote.people || []).slice(0, MAX_PEOPLE).map((p, i) => {
    const mine = p.id === Sync.me;
    const prev = state.people.find(x => x.id === p.id);
    const keepLocal = mine && editing && i === mineIdx;
    return {
      id: p.id,
      name: keepLocal && prev ? prev.name : (p.name || ''),
      lat: p.lat, lon: p.lon,
      label: prev?.label || (p.lat != null ? 'Shared location' : ''),
      status: p.lat != null
        ? (mine ? 'You — on the map' : 'On the map')
        : (mine ? 'Tap Locate to add yourself' : 'Joined, no location shared yet')
    };
  });
  state.me = Sync.me;

  state.votes = {};
  for (const v of (remote.votes || [])) {
    (state.votes[v.venue_key] ||= {})[v.participant_id] = v.dir;
  }
  if (Array.isArray(remote.cats) && remote.cats.length) state.cats = remote.cats;

  renderPeople(); renderCats(); renderLive(); drawMap();
  if (state.results.length) renderResults();
}

function renderCats() {
  const host = $('#cats');
  host.innerHTML = '';
  for (const [k, c] of Object.entries(CATS)) {
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
      if (isLive()) Sync.prefs(state.cats, null);
    });
    host.appendChild(b);
  }

  const lucky = document.createElement('button');
  lucky.className = 'chip lucky' + (state.lucky ? ' on' : '');
  lucky.id = 'lucky';
  lucky.textContent = state.lucky ? '🎲 Re-roll' : '🎲 Feeling lucky';
  lucky.addEventListener('click', rollLucky);
  host.appendChild(lucky);
}

/* Pick a few activity types at random and search straight away. Re-rolling
   picks a different set, so tapping twice never gives the same answer. */
function rollLucky() {
  const keys = Object.keys(CATS);
  const next = pickRandom(keys, LUCKY_CATS);
  // Never re-roll into the identical set — a re-roll that changes nothing
  // reads as a broken button.
  state.cats = (state.lucky && next.every(k => state.cats.includes(k)))
    ? pickRandom(keys.filter(k => !state.cats.includes(k)), LUCKY_CATS)
    : next;
  state.lucky = true;
  renderCats(); syncURL();
  if (isLive()) Sync.prefs(state.cats, null);
  search();
}

function tally(key) {
  const v = state.votes[key] || {};
  let up = 0, down = 0;
  for (const val of Object.values(v)) val > 0 ? up++ : down++;
  return { up, down };
}

function renderResults(selectedKey) {
  const host = $('#results');
  host.innerHTML = '';
  if (!state.results.length) return;

  const worst = Math.max(...state.results.flatMap(v => v.costs));
  const unit = fmtMin;
  const approx = state.estimated ? '~' : '';

  state.results.slice(0, 10).forEach((v, i) => {
    const t = tally(v.key);
    const myVote = (state.votes[v.key] || {})[state.me];
    const card = document.createElement('div');
    card.className = 'venue' + (v.key === selectedKey ? ' sel' : '');

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
      <div class="fair">${state.people.map((p, pi) => `
        <div class="fairrow">
          <span class="nm">${esc(p.name || 'P' + (pi + 1))}</span>
          <span class="bar"><i style="width:${Math.max(4, 100 * v.costs[pi] / worst)}%;background:${COLORS[pi % COLORS.length]}"></i></span>
          <span class="tm">${approx}${unit(v.costs[pi])}</span>
        </div>`).join('')}
      </div>
      <div class="vactions">
        <button class="vote up ${myVote > 0 ? 'on' : ''}">👍</button>
        <button class="vote down ${myVote < 0 ? 'on' : ''}">👎</button>
        <a class="maplink" target="_blank" rel="noopener"
           href="https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lon}#map=18/${v.lat}/${v.lon}">Open map ↗</a>
        <span class="tally">${t.up}👍 ${t.down}👎</span>
      </div>`;

    card.addEventListener('click', e => {
      if (e.target.closest('.vote') || e.target.closest('a')) return;
      drawMap(v.key); renderResults(v.key);
    });
    card.querySelector('.vote.up').addEventListener('click', () => vote(v.key, 1));
    card.querySelector('.vote.down').addEventListener('click', () => vote(v.key, -1));
    host.appendChild(card);
  });

  const note = document.createElement('div');
  note.className = 'note';
  note.innerHTML = 'Votes and everyone’s pins live in the link, not on a server. '
    + 'Tap <b>Copy invite link</b> after voting and send it back so the group sees your picks.';
  host.appendChild(note);
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
  const located = state.people.filter(p => p.lat != null);
  if (!located.length) { log('Add at least one location first.'); return; }

  $('#find').disabled = true;
  state.results = [];
  renderResults();

  try {
    const center = centroid(located);
    state.center = center;

    const maxFromCenter = Math.max(...located.map(p => haversine(p, center)), 0);
    const radius = Math.min(20000, Math.max(1500, maxFromCenter * 0.45));

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
    venues = scoreVenues(venues, located, null).slice(0, MAX_VENUES);

    let matrix = null;
    log(`Getting drive times for ${located.length} × ${venues.length} pairs…`, true);
    try {
      matrix = await driveTimes(located, venues);
    } catch {
      // Not a user-visible mode: distance stands in for time until OSRM returns,
      // and every figure is marked "~" so an estimate never reads as measured.
      log('Drive-time service unavailable — showing distance-based estimates.');
    }

    state.results = scoreVenues(venues, located, matrix);
    state.estimated = !matrix;

    if (state.lucky) {
      // Shuffle within the fairest handful rather than across everything:
      // a "random" pick that is 40 minutes from one person defeats the point.
      const pool = state.results.slice(0, LUCKY_POOL);
      state.results = shuffle(pool).concat(state.results.slice(LUCKY_POOL));
      const picked = state.cats.map(c => CATS[c]?.label.replace(/^\S+\s/, '')).join(', ');
      log(`🎲 ${picked} — shuffled from the ${pool.length} fairest. Tap Re-roll for another.`);
    }
    else if (chainsHidden === -1)
      log(`Only chains near this midpoint — showing them anyway.`);
    else if (matrix)
      log(`${state.results.length} spots, ranked by real drive time.`
          + (chainsHidden ? ` ${chainsHidden} chain${chainsHidden > 1 ? 's' : ''} hidden.` : ''));
    else { /* fallback message already set */ }

    drawMap(state.results[0]?.key);
    renderResults(state.results[0]?.key);
    syncURL();
  } catch (e) {
    log('Search failed: ' + e.message);
  } finally {
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
  $('#whenDay').value = state.when;
  $('#whenTime').value = state.whenTime;
  $('#whenTime').hidden = !/^[0-6]$/.test(state.when);
  $('#price').value = state.maxPrice;

  renderPeople();
  renderCats();
  drawMap();

  $('#addPerson').addEventListener('click', () => { addPerson(); refresh(); });
  wireLive();
  $('#find').addEventListener('click', search);

  $('#noChains').addEventListener('click', e => {
    state.noChains = !state.noChains;
    e.currentTarget.classList.toggle('on', state.noChains);
    syncURL();
  });
  $('#whenDay').addEventListener('change', e => {
    state.when = e.target.value;
    $('#whenTime').hidden = !/^[0-6]$/.test(state.when);
    syncURL();
  });
  $('#whenTime').addEventListener('change', e => {
    state.whenTime = e.target.value || '19:00';
    syncURL();
  });
  $('#price').addEventListener('change', e => { state.maxPrice = e.target.value; syncURL(); });

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

  $('#goLive').addEventListener('click', async () => {
    const me = myRow();
    $('#goLive').disabled = true;

    // Put yourself on the map before anyone joins: an empty map after tapping
    // Go live reads as a failure, even though the session was created fine.
    if (me && !me.name.trim()) { me.name = savedName() || 'Me'; renderPeople(); }
    if (me && me.lat == null) {
      log('Getting your location…', true);
      try { await locateAsync(me); }
      catch { /* denied or unavailable — go live anyway, the row says why */ }
    }

    try {
      await Sync.create(me?.name || 'Me', me?.lat ?? null, me?.lon ?? null);
      state.liveErr = '';
      history.replaceState(null, '', `?s=${Sync.code}`);
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

  $('#endLive').addEventListener('click', async () => {
    await Sync.leave();
    history.replaceState(null, '', location.pathname);
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
    await Sync.join(code, me?.name || '', me?.lat ?? null, me?.lon ?? null);
    state.liveErr = '';
    history.replaceState(null, '', `?s=${code}`);
    log(fromLink
      ? 'Joined the session — tap Locate to add yourself to the map.'
      : 'Joined the session.');
  } catch (e) {
    state.liveErr = e.message;
  }
  renderLive();
}

// Best-effort tidy-up so a closed tab does not leave a ghost pin behind.
window.addEventListener('pagehide', () => {
  if (isLive() && navigator.sendBeacon) {
    navigator.sendBeacon(`${Sync.url}/rest/v1/rpc/mp_leave?apikey=${encodeURIComponent(Sync.key)}`,
      new Blob([JSON.stringify({ p_code: Sync.code, p_participant: Sync.me })],
               { type: 'application/json' }));
  }
});

document.addEventListener('DOMContentLoaded', boot);
