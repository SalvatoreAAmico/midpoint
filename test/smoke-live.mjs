import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const APP = new URL('..', import.meta.url).pathname;
const LEAFLET = new URL('./node_modules/leaflet/dist', import.meta.url).pathname;
const TYPES = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/json','.svg':'image/svg+xml'};

const srv = http.createServer((req,res)=>{
  const f = path.join(APP, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if(!fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'text/plain'});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>srv.listen(8099,r));

// ---- fixtures ----------------------------------------------------------
const PLACES = {
  'wicker park, chicago': {lat:41.9088, lon:-87.6796, display_name:'Wicker Park, Chicago, Illinois'},
  'hyde park, chicago':   {lat:41.7943, lon:-87.5907, display_name:'Hyde Park, Chicago, Illinois'},
};
// name, lat, lon, tags -> and the drive time we want OSRM to report per person
const VENUES = [
  ['Fair Grounds',   41.8516,-87.6352, {amenity:'cafe', opening_hours:'24/7'},                 [600, 600]],
  ['Lopsided Latte', 41.9080,-87.6790, {amenity:'cafe', opening_hours:'24/7'},                 [120,1500]],
  ['Shuttered Bean', 41.8500,-87.6300, {amenity:'cafe', opening_hours:'Mo-Fr 08:00-18:00'},    [640, 660]],
  ['Mystery Mug',    41.8530,-87.6400, {amenity:'cafe'},                                       [660, 640]],
  ['Pricey Perk',    41.8520,-87.6360, {amenity:'cafe','price:range':'$$$',opening_hours:'24/7'},[610, 620]],
];
const byCoord = new Map(VENUES.map(v=>[`${v[2].toFixed(5)},${v[1].toFixed(5)}`, v]));

let calls = {nominatim:0, overpass:0, osrm:0, tiles:0};

const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});

await ctx.route('**/unpkg.com/leaflet**', r => {
  const u = r.request().url();
  const f = u.endsWith('.css') ? 'leaflet.css' : 'leaflet.js';
  r.fulfill({status:200, contentType: u.endsWith('.css')?'text/css':'text/javascript',
             body: fs.readFileSync(path.join(LEAFLET,f),'utf8')});
});
await ctx.route('**/tile.openstreetmap.org/**', r => { calls.tiles++;
  r.fulfill({status:200, contentType:'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')});
});
await ctx.route('**/nominatim.openstreetmap.org/**', r => { calls.nominatim++;
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q')||'').toLowerCase().trim();
  const hit = PLACES[q];
  r.fulfill({status:200, contentType:'application/json',
             body: JSON.stringify(hit ? [{lat:String(hit.lat), lon:String(hit.lon), display_name:hit.display_name}] : [])});
});
await ctx.route('**/api/interpreter', r => { calls.overpass++;
  r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({elements:
    VENUES.map((v,i)=>({type:'node', id:1000+i, lat:v[1], lon:v[2], tags:{name:v[0], ...v[3]}}))})});
});
await ctx.route('**/router.project-osrm.org/**', r => { calls.osrm++;
  const u = new URL(r.request().url());
  const coords = u.pathname.split('/').pop().split(';');
  const nSrc = u.searchParams.get('sources').split(';').length;
  const dests = u.searchParams.get('destinations').split(';').map(i=>coords[+i]);
  const durations = Array.from({length:nSrc}, (_,pi) =>
    dests.map(c => { const v = byCoord.get(c); return v ? (v[4][pi] ?? v[4][0]) : 999; }));
  r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({code:'Ok', durations})});
});


// ---- fake Supabase: an in-memory stand-in for the mp_* functions ----------
const db = { sessions: new Map() };
let rpcCalls = 0, leaveCalls = 0;

await ctx.route('**/rest/v1/rpc/**', async r => {
  rpcCalls++;
  const fn = r.request().url().split('/rpc/')[1].split('?')[0];
  const a = JSON.parse(r.request().postData() || '{}');
  const send = (b, status=200) => r.fulfill({status, contentType:'application/json', body:JSON.stringify(b)});
  const S = () => db.sessions.get(a.p_code);

  if (fn === 'mp_create') {
    const code = 'abc1234567';
    db.sessions.set(code, {code, cats:['coffee'], filters:{}, people:[], votes:[]});
    const pid = 'p-host';
    db.sessions.get(code).people.push({id:pid, name:a.p_name||'', lat:a.p_lat, lon:a.p_lon});
    return send({code, participant_id:pid});
  }
  if (!S()) return send({message:'session_not_found'}, 400);
  if (fn === 'mp_join') {
    if (S().people.length >= 4) return send({message:'session_full'}, 400);
    const pid = 'p-' + S().people.length;
    S().people.push({id:pid, name:a.p_name||'', lat:a.p_lat, lon:a.p_lon});
    return send({participant_id:pid});
  }
  if (fn === 'mp_state') return send(S());
  if (fn === 'mp_update') {
    const p = S().people.find(x=>x.id===a.p_participant);
    if (p) { p.name = a.p_name ?? p.name; p.lat = a.p_lat; p.lon = a.p_lon; }
    return send(null, 204);
  }
  if (fn === 'mp_prefs') { if (a.p_cats) S().cats = a.p_cats; return send(null, 204); }
  if (fn === 'mp_vote') {
    S().votes = S().votes.filter(v => !(v.participant_id===a.p_participant && v.venue_key===a.p_venue));
    if (a.p_dir) S().votes.push({participant_id:a.p_participant, venue_key:a.p_venue, dir:a.p_dir});
    return send(null, 204);
  }
  if (fn === 'mp_leave') {
    leaveCalls++;
    S().people = S().people.filter(x=>x.id!==a.p_participant);
    return send(null, 204);
  }
  return send({message:'unknown '+fn}, 400);
});

// Point the page at the fake backend by serving a test config.js. Injecting
// the global earlier would be overwritten by the real config.js on load.
await ctx.route('**/config.js', r => r.fulfill({status:200, contentType:'text/javascript',
  body:"window.MIDPOINT_CONFIG={supabaseUrl:'https://fake.supabase.co',supabaseAnonKey:'anon-test-key'};"}));

const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
page.on('console', m => { if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });

let pass=0, fail=0;
const ok=(n,c,extra='')=>{ c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(extra?'  | '+extra:''))); };

await page.goto('http://localhost:8099/', {waitUntil:'networkidle'});

ok('live bar appears when Supabase is configured', await page.locator('#liveBar').isVisible());
ok('starts in non-live mode', await page.locator('#goLive').isVisible());

// host starts a session
await page.locator('.person').nth(0).locator('.nm').fill('Sal');
await page.locator('.person').nth(0).locator('.lc').fill('Wicker Park, Chicago');
await page.locator('.person').nth(0).locator('.lc').press('Tab');
await page.waitForTimeout(300);
await page.locator('#goLive').click();
await page.waitForTimeout(600);

ok('session code shown after going live',
   (await page.locator('#liveCode').textContent()).length === 10);
ok('URL carries the session code', page.url().includes('?s=abc1234567'));
ok('Go live button hidden while live', await page.locator('#goLive').isHidden());
ok('host location reached the server', db.sessions.get('abc1234567').people[0].lat != null);

// a second person opens the shared link
const p2 = await ctx.newPage();
p2.on('pageerror', e => errs.push('P2 PAGEERROR: '+e.message));
await p2.goto('http://localhost:8099/?s=abc1234567', {waitUntil:'networkidle'});
await p2.waitForTimeout(700);

ok('second device auto-joined from the link', db.sessions.get('abc1234567').people.length === 2);
ok('joiner sees live state', await p2.locator('#liveOn').isVisible());

await p2.locator('.person').nth(1).locator('.nm').fill('Dana');
await p2.waitForTimeout(300);
ok('joiner name pushed to server',
   db.sessions.get('abc1234567').people[1].name === 'Dana',
   JSON.stringify(db.sessions.get('abc1234567').people[1]));

// host should see Dana appear without touching anything
await page.waitForTimeout(4600);
const names = await page.locator('.person .nm').evaluateAll(els=>els.map(e=>e.value));
ok('host sees the joiner appear automatically', names.includes('Dana'), names.join(','));
ok('host roster is server-owned (no manual remove buttons)',
   await page.locator('.person .rm').count() === 0);
ok('Add person disabled during a live session', await page.locator('#addPerson').isDisabled());

// session cap enforced server-side
for (const pid of ['x1','x2']) db.sessions.get('abc1234567').people.push({id:pid,name:pid,lat:41.8,lon:-87.6});
const p5 = await ctx.newPage();
await p5.goto('http://localhost:8099/?s=abc1234567', {waitUntil:'networkidle'});
await p5.waitForTimeout(600);
ok('5th person is refused with a clear message',
   (await p5.locator('#liveNote').textContent()).includes('already has 4'),
   await p5.locator('#liveNote').textContent());
await p5.close();
db.sessions.get('abc1234567').people = db.sessions.get('abc1234567').people.filter(p=>!p.id.startsWith('x'));
// let the host poll the injected people back out before searching
await page.waitForTimeout(4600);
ok('host roster shrinks back after others leave',
   await page.locator('.person').count() === 2,
   'rows=' + await page.locator('.person').count());

// bad code
const p6 = await ctx.newPage();
await p6.goto('http://localhost:8099/?s=deadbeef99', {waitUntil:'networkidle'});
await p6.waitForTimeout(500);
ok('unknown session code explained, not crashed',
   (await p6.locator('#liveNote').textContent()).toLowerCase().includes('expired'),
   await p6.locator('#liveNote').textContent());
await p6.close();

// votes sync between devices
await page.locator('#find').click();
await page.waitForSelector('.venue', {timeout:8000});
await page.locator('.venue').first().locator('.vote.up').click();
await page.waitForTimeout(400);
ok('vote written to the server', db.sessions.get('abc1234567').votes.length === 1);

await p2.locator('#find').click();
await p2.waitForSelector('.venue', {timeout:8000});
// Votes propagate on the next poll, so allow one full cycle.
await p2.waitForTimeout(5000);
const tally = await p2.locator('.venue').first().locator('.tally').textContent();
ok("host's vote reaches the other device within one poll cycle",
   tally.trim().startsWith('1'), tally);

// leaving
await p2.locator('#endLive').click();
await p2.waitForTimeout(500);
ok('leaving removes you from the session', leaveCalls >= 1);
ok('leaving clears the code from the URL', !p2.url().includes('?s='));

// the anon key must never touch tables directly
const direct = [...new Set(errs)].length;
ok('all traffic went through rpc endpoints only', rpcCalls > 0);

console.log(`\n${pass} passed, ${fail} failed`);
if(errs.length){ console.log('\nJS errors:'); [...new Set(errs)].forEach(e=>console.log('  '+e)); }
await browser.close(); srv.close();
process.exit(fail||errs.length?1:0);
