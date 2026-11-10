/* Hits the REAL OpenStreetMap services. Everything else in test/ mocks them,
   which is why a live outage was invisible to all six suites while search was
   broken on Sal's phone.
 *
 *   node test/live-apis.mjs
 *
 * Deliberately NOT one of the six and NOT in CI: it needs network, and these
 * are free public services that go busy without warning, so in CI it would be
 * flaky and would train people to ignore a red build. Run it when somebody
 * says "search is broken" -- it answers, in about ten seconds, whether the
 * problem is us or them.
 *
 * Exit code: 1 only if Overpass has no working mirror, because that is the
 * one failure that breaks a search outright. A dead OSRM degrades to
 * distance estimates and a dead Nominatim only stops typed places, so those
 * are reported and do not fail the run.
 */
import fs from 'fs';

/* Read the endpoints out of app.js rather than repeating them here. A mirror
   added to the app but not to this file would be exactly the one nobody
   checks. */
const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const list = name => {
  const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
};
const one = name => (src.match(new RegExp(`const ${name} = '([^']+)'`)) || [])[1];

const OVERPASS = list('OVERPASS');
const NOMINATIM = one('NOMINATIM');
const OSRM = one('OSRM');

const TIMEOUT_MS = 10000;
let overpassOk = 0;

const get = async (url, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
};

/* A browser sees "at capacity" as a CORS failure, because the refusal comes
   back without the header. Node has no CORS, so here the same server answers
   with a readable status -- which is the point: this tells you what the phone
   could not. */
const why = e => e?.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000}s`
                                          : (e?.message || String(e));

console.log(`Overpass — ${OVERPASS.length} mirrors, the one that breaks search`);
for (const host of OVERPASS) {
  const name = new URL(host).host;
  try {
    const res = await get(host, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(
        '[out:json][timeout:10];node["amenity"="cafe"](around:400,41.8781,-87.6298);out center 3;')
    });
    if (!res.ok) { console.log(`  BUSY ${name}  HTTP ${res.status}`); continue; }
    const data = await res.json();
    const n = (data.elements || []).length;
    console.log(`  ok   ${name}  ${n} element${n === 1 ? '' : 's'}`);
    overpassOk++;
  } catch (e) { console.log(`  DOWN ${name}  ${why(e)}`); }
}

console.log('\nNominatim — typed places only; a search still works without it');
try {
  const res = await get(`${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent('Leominster, MA')}`,
                        { headers: { 'Accept': 'application/json' } });
  const hit = res.ok ? (await res.json())[0] : null;
  console.log(hit?.lat ? `  ok   resolved to ${(+hit.lat).toFixed(3)}, ${(+hit.lon).toFixed(3)}`
                       : `  FAIL HTTP ${res.status}, no usable result`);
} catch (e) { console.log(`  FAIL ${why(e)}`); }

console.log('\nOSRM — travel times; without it the app falls back to distance');
try {
  const res = await get(`${OSRM}driving/-87.6796,41.9088;-87.5907,41.7943`
                        + '?sources=0&destinations=1&annotations=duration');
  const data = res.ok ? await res.json() : null;
  const secs = data?.durations?.[0]?.[0];
  console.log(Number.isFinite(secs) ? `  ok   ${Math.round(secs / 60)} min between the two test points`
                                    : `  FAIL HTTP ${res.status}, no durations`);
} catch (e) { console.log(`  FAIL ${why(e)}`); }

console.log(`\n${overpassOk} of ${OVERPASS.length} Overpass mirrors answered.`);
if (!overpassOk) {
  console.log('Search cannot work right now: no mirror is answering. If this');
  console.log('machine can reach the internet, they are all busy — wait, or add');
  console.log('another mirror to OVERPASS in app.js.');
}
process.exit(overpassOk ? 0 : 1);
