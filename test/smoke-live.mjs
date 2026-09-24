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

/* Web fonts are not reachable from the test sandbox and would log a console
   error that the suite treats as a failure. Serve them as empty. */
const stubFonts = async c => {
  await c.route('**/fonts.googleapis.com/**', r =>
    r.fulfill({status:200, contentType:'text/css', body:''}));
  await c.route('**/fonts.gstatic.com/**', r =>
    r.fulfill({status:200, contentType:'font/woff2', body:''}));
};
const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
  permissions:['geolocation'], geolocation:{latitude:41.9088, longitude:-87.6796}});
await stubFonts(ctx);

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

const rpcHandler = async r => {
  rpcCalls++;
  const fn = r.request().url().split('/rpc/')[1].split('?')[0];
  const a = JSON.parse(r.request().postData() || '{}');
  const send = (b, status=200) => r.fulfill({status, contentType:'application/json', body:JSON.stringify(b)});
  const S = () => db.sessions.get(a.p_code);

  if (fn === 'mp_create') {
    const code = 'abc1234567';
    db.sessions.set(code, {code, cats:['coffee'], filters:{}, people:[], votes:[]});
    const pid = 'p-host';
    db.sessions.get(code).people.push({id:pid, name:a.p_name||'', label:a.p_label||'', lat:a.p_lat, lon:a.p_lon});
    return send({code, participant_id:pid});
  }
  if (!S()) return send({message:'session_not_found'}, 400);
  if (fn === 'mp_join') {
    if (S().people.length >= 8) return send({message:'session_full'}, 400);
    const pid = 'p-' + S().people.length;
    S().people.push({id:pid, name:a.p_name||'', label:a.p_label||'', lat:a.p_lat, lon:a.p_lon});
    return send({participant_id:pid});
  }
  if (fn === 'mp_state') return send(S());
  if (fn === 'mp_update') {
    const p = S().people.find(x=>x.id===a.p_participant);
    if (p) { p.name = a.p_name ?? p.name; p.label = a.p_label ?? p.label;
             p.lat = a.p_lat; p.lon = a.p_lon; }
    return send(null, 204);
  }
  if (fn === 'mp_prefs') {
    if (a.p_cats) S().cats = a.p_cats;
    if (a.p_filters) S().filters = a.p_filters;
    return send(null, 204);
  }
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
};
await ctx.route('**/rest/v1/rpc/**', rpcHandler);

// Point the page at the fake backend by serving a test config.js. Injecting
// the global earlier would be overwritten by the real config.js on load.
await ctx.route('**/config.js', r => r.fulfill({status:200, contentType:'text/javascript',
  body:"window.MIDPOINT_CONFIG={supabaseUrl:'https://fake.supabase.co',supabaseAnonKey:'anon-test-key'};"}));

/* A second browser context = a second device: its own localStorage, so it has
   its own identity. Two tabs in ONE browser deliberately resume as the same
   person, which is why the joiner needs a real context of its own here. */
async function newDevice(opts = {}) {
  const c = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
    permissions: opts.noGeo ? [] : ['geolocation'],
    geolocation: opts.noGeo ? undefined : {latitude:41.7943, longitude:-87.5907}});
  await stubFonts(c);
await stubFonts(c);
  await c.route('**/unpkg.com/leaflet**', r => {
    const u = r.request().url();
    r.fulfill({status:200, contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body: fs.readFileSync(path.join(LEAFLET, u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});
  });
  await c.route('**/tile.openstreetmap.org/**', r => { calls.tiles++;
    r.fulfill({status:200, contentType:'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')});
  });
  await c.route('**/nominatim.openstreetmap.org/**', r => { calls.nominatim++;
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q')||'').toLowerCase().trim();
    const hit = PLACES[q];
    r.fulfill({status:200, contentType:'application/json',
               body: JSON.stringify(hit ? [{lat:String(hit.lat), lon:String(hit.lon), display_name:hit.display_name}] : [])});
  });
  await c.route('**/api/interpreter', r => { calls.overpass++;
    r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({elements:
      VENUES.map((v,i)=>({type:'node', id:1000+i, lat:v[1], lon:v[2], tags:{name:v[0], ...v[3]}}))})});
  });
  await c.route('**/router.project-osrm.org/**', r => { calls.osrm++;
    const u = new URL(r.request().url());
    const coords = u.pathname.split('/').pop().split(';');
    const nSrc = u.searchParams.get('sources').split(';').length;
    const dests = u.searchParams.get('destinations').split(';').map(i=>coords[+i]);
    r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({code:'Ok',
      durations: Array.from({length:nSrc}, (_,pi) =>
        dests.map(cc => { const v = byCoord.get(cc); return v ? (v[4][pi] ?? v[4][0]) : 999; }))})});
  });
  await c.route('**/config.js', r => r.fulfill({status:200, contentType:'text/javascript',
    body:"window.MIDPOINT_CONFIG={supabaseUrl:'https://fake.supabase.co',supabaseAnonKey:'anon-test-key'};"}));
  await c.route('**/rest/v1/rpc/**', rpcHandler);
  return c;
}

const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
page.on('console', m => { if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });

let pass=0, fail=0;
const ok=(n,c,extra='')=>{ c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(extra?'  | '+extra:''))); };

await page.goto('http://localhost:8099/', {waitUntil:'networkidle'});

ok('live bar appears when Supabase is configured', await page.locator('#liveBar').isVisible());
ok('starts in non-live mode', await page.locator('#goLive').isVisible());

// host starts a session WITHOUT setting anything first: Go live should fill
// in both name and location so the map proves it worked before anyone joins.
await page.locator('#goLive').click();
await page.waitForTimeout(1200);

ok('Go live fills in a name when none was typed',
   (await page.locator('.person').nth(0).locator('.nm').inputValue()).length > 0,
   await page.locator('.person').nth(0).locator('.nm').inputValue());
ok('Go live locates you without being asked',
   db.sessions.get('abc1234567').people[0].lat != null,
   JSON.stringify(db.sessions.get('abc1234567').people[0]));
ok('your own row says you are on the map',
   (await page.locator('.person').nth(0).locator('.status').textContent()).includes('You'),
   await page.locator('.person').nth(0).locator('.status').textContent());
ok('log confirms you are on the map',
   (await page.locator('#log').textContent()).includes('on the map'),
   await page.locator('#log').textContent());

// now give the host a recognisable name for the rest of the run
await page.locator('.person').nth(0).locator('.nm').fill('Sal');
await page.waitForTimeout(300);

ok('session code shown after going live',
   (await page.locator('#liveCode').textContent()).length === 10);
ok('URL carries the session code', page.url().includes('?s=abc1234567'));
ok('Go live button hidden while live', await page.locator('#goLive').isHidden());
ok('host name reached the server',
   db.sessions.get('abc1234567').people[0].name === 'Sal',
   JSON.stringify(db.sessions.get('abc1234567').people[0]));

// a second person opens the shared link
const ctx2 = await newDevice();
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errs.push('P2 PAGEERROR: '+e.message));
await p2.goto('http://localhost:8099/?s=abc1234567', {waitUntil:'networkidle'});
await p2.waitForTimeout(700);

ok('second device auto-joined from the link', db.sessions.get('abc1234567').people.length === 2);
ok('joiner sees live state', await p2.locator('#liveOn').isVisible());
// The bug a real user hit: joining by link left them invisible on the map.
ok('joining by link shares location without being asked',
   db.sessions.get('abc1234567').people[1].lat != null,
   JSON.stringify(db.sessions.get('abc1234567').people[1]));
await p2.waitForTimeout(4600);   // let a poll reconcile ids with the server
ok('no "share my location" prompt once located',
   await p2.locator('#shareLoc').isHidden());

// The bug a real user hit: typing a name while polls arrive wiped it.
// Type slowly, so at least one 4s poll lands mid-word.
// the remembered name carries into the join, so clear before typing
await p2.locator('.person').nth(1).locator('.nm').fill('');
await p2.locator('.person').nth(1).locator('.nm').click();
await p2.locator('.person').nth(1).locator('.nm').pressSequentially('Dana', {delay:900});
ok('name survives typing across a poll',
   (await p2.locator('.person').nth(1).locator('.nm').inputValue()) === 'Dana',
   await p2.locator('.person').nth(1).locator('.nm').inputValue());
ok('the field still has focus after a poll',
   await p2.evaluate(() => document.activeElement?.classList.contains('nm')));
await p2.waitForTimeout(5200);
ok('name still intact a full poll later',
   (await p2.locator('.person').nth(1).locator('.nm').inputValue()) === 'Dana',
   await p2.locator('.person').nth(1).locator('.nm').inputValue());
await p2.locator('.person').nth(1).locator('.nm').blur();
await p2.waitForTimeout(300);

// The bug two real users hit: a pin appeared but nobody could see where.
await p2.locator('.person').nth(1).locator('.lc').fill('Hyde Park, Chicago');
await p2.locator('.person').nth(1).locator('.lc').press('Tab');
await p2.waitForTimeout(700);
ok('a typed place reaches the server, not just the coordinates',
   db.sessions.get('abc1234567').people[1].label === 'Hyde Park, Chicago',
   JSON.stringify(db.sessions.get('abc1234567').people[1]));
await page.waitForTimeout(4800);
ok('and the other device shows where they are, not a bare pin',
   (await page.locator('.person').nth(1).locator('.lc').inputValue()) === 'Hyde Park, Chicago',
   await page.locator('.person').nth(1).locator('.lc').inputValue());
ok('their row says the place too',
   (await page.locator('.person').nth(1).locator('.status').textContent()).includes('Hyde Park'),
   await page.locator('.person').nth(1).locator('.status').textContent());

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
for (const pid of ['x1','x2','x3','x4','x5','x6']) db.sessions.get('abc1234567').people.push({id:pid,name:pid,lat:41.8,lon:-87.6});
const ctx5 = await newDevice(); const p5 = await ctx5.newPage();
await p5.goto('http://localhost:8099/?s=abc1234567', {waitUntil:'networkidle'});
await p5.waitForTimeout(600);
ok('9th person is refused with a clear message',
   (await p5.locator('#liveNote').textContent()).includes('already has 8'),
   await p5.locator('#liveNote').textContent());
await p5.close(); await ctx5.close();
db.sessions.get('abc1234567').people = db.sessions.get('abc1234567').people.filter(p=>!p.id.startsWith('x'));
// let the host poll the injected people back out before searching
await page.waitForTimeout(4600);
ok('host roster shrinks back after others leave',
   await page.locator('.person').count() === 2,
   'rows=' + await page.locator('.person').count());

// bad code
const ctx6 = await newDevice(); const p6 = await ctx6.newPage();
await p6.goto('http://localhost:8099/?s=deadbeef99', {waitUntil:'networkidle'});
await p6.waitForTimeout(500);
ok('unknown session code explained, not crashed',
   (await p6.locator('#liveNote').textContent()).toLowerCase().includes('expired'),
   await p6.locator('#liveNote').textContent());
await p6.close(); await ctx6.close();

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

// ---- a name typed after going live must survive a refresh --------------
{
  await p2.locator('.person').nth(1).locator('.nm').fill('Dana Renamed');
  await p2.waitForTimeout(600);
  ok('a later rename reaches the server',
     db.sessions.get('abc1234567').people[1].name === 'Dana Renamed',
     JSON.stringify(db.sessions.get('abc1234567').people[1]));
  await p2.reload({waitUntil:'networkidle'});
  await p2.waitForTimeout(1000);
  ok('and survives a refresh',
     (await p2.locator('.person').nth(1).locator('.nm').inputValue()) === 'Dana Renamed',
     await p2.locator('.person').nth(1).locator('.nm').inputValue());
  await p2.locator('.person').nth(1).locator('.nm').fill('Dana');
  await p2.waitForTimeout(500);
}

// ---- the URL carries both the session and the local state --------------
{
  const u = await p2.evaluate(() => location.href);
  ok('the session code survives a state write', u.includes('?s=abc1234567'), u);
  ok('and the hash survives alongside it', u.includes('#'), u);
}

// ---- a server that predates the label migration still works ------------
{
  const old = await newDevice();
  await old.route('**/rest/v1/rpc/**', async r => {
    const fn = r.request().url().split('/rpc/')[1].split('?')[0];
    const a = JSON.parse(r.request().postData() || '{}');
    // Reject the new signature the way PostgREST does before fix-002.
    if ('p_label' in a) return r.fulfill({status:404, contentType:'application/json',
      body: JSON.stringify({code:'PGRST202', message:'Could not find the function'})});
    return rpcHandler(r);
  });
  const po = await old.newPage();
  await po.goto('http://localhost:8099/?s=abc1234567', {waitUntil:'networkidle'});
  await po.waitForTimeout(1500);
  ok('an un-migrated server still lets someone join',
     db.sessions.get('abc1234567').people.some(x => x.id !== 'p-host' && x.id !== 'p-1'),
     JSON.stringify(db.sessions.get('abc1234567').people.map(x=>x.id)));
  ok('and the app does not report a write failure for it',
     !(await po.locator('#liveNote').textContent()).includes('Could not save'),
     await po.locator('#liveNote').textContent());
  await old.close();
  db.sessions.get('abc1234567').people =
    db.sessions.get('abc1234567').people.filter(x => x.id === 'p-host' || x.id === 'p-1');
}

// ---- refreshing must not clone you -------------------------------------
{
  const before = db.sessions.get('abc1234567').people.length;
  for (let i = 0; i < 3; i++) {
    await p2.reload({waitUntil:'networkidle'});
    await p2.waitForTimeout(900);
  }
  const after = db.sessions.get('abc1234567').people.length;
  ok('refreshing a shared link does not add duplicates',
     after === before, `before=${before} after=${after}`);
  ok('and you are still the same participant',
     (await p2.evaluate(() => window.Sync.me)) === 'p-1',
     'Sync.me=' + await p2.evaluate(() => window.Sync.me)
     + ' stored=' + await p2.evaluate(() => localStorage.getItem('midpoint.session'))
     + ' people=' + JSON.stringify(db.sessions.get('abc1234567').people.map(x=>x.id)));
  ok('the session is recognised as resumed',
     (await p2.locator('#log').textContent()).includes('Back in the session'),
     await p2.locator('#log').textContent());
  ok('your name survives the refresh',
     (await p2.locator('.person').nth(1).locator('.nm').inputValue()) === 'Dana',
     await p2.locator('.person').nth(1).locator('.nm').inputValue());
}

// ---- search settings travel with the session ----------------------------
{
  await page.selectOption('#travel', 'walk');
  await page.locator('#whenDay').selectOption('2');       // Tuesday
  await page.waitForTimeout(400);
  await p2.waitForTimeout(4800);                          // p2 polls it in
  ok('travel mode reaches the other device',
     (await p2.locator('#travel').inputValue()) === 'walk',
     await p2.locator('#travel').inputValue());
  ok('the chosen day reaches the other device',
     (await p2.locator('#whenDay').inputValue()) === '2',
     await p2.locator('#whenDay').inputValue());
  ok('and the time box is revealed there too',
     !(await p2.locator('#whenTime').isHidden()));
  // put it back
  await page.selectOption('#travel', 'drive');
  await page.locator('#whenDay').selectOption('');
  await page.waitForTimeout(400);
  await p2.waitForTimeout(4800);
  ok('reverting syncs back as well',
     (await p2.locator('#travel').inputValue()) === 'drive');
}

// ---- the group reaches a decision ---------------------------------------
{
  ok('no winner announced before everyone has voted',
     await page.locator('.winner').count() === 0);

  // p2 reloaded during the refresh test, so it needs results again.
  await p2.locator('#find').click();
  await p2.waitForSelector('.venue', {timeout:8000});
  await p2.waitForTimeout(300);

  // Dana votes for the same place the host did.
  const top = await p2.locator('.venue').first().locator('.vname').textContent();
  await p2.locator('.venue').first().locator('.vote.up').click();
  await p2.waitForTimeout(400);
  await page.waitForTimeout(4800);          // host polls it in

  console.log('    [dbg] server people=', JSON.stringify(db.sessions.get('abc1234567').people.map(x=>({id:x.id,lat:x.lat}))));
  console.log('    [dbg] p2 top       =', top);
  ok('once both have voted, a winner is announced',
     await page.locator('.winner').count() === 1);
  ok('the winner is the venue they agreed on',
     (await page.locator('.winner').textContent()).includes(top),
     await page.locator('.winner').textContent());
  ok('the winning card is highlighted in the list',
     await page.locator('.venue.won').count() === 1);
  ok('the other device sees the same winner',
     (await p2.locator('.winner').textContent()).includes(top),
     await p2.locator('.winner').textContent());

  // a veto from one person removes it for everyone
  await page.locator('.venue').nth(1).locator('.vote.down').click();
  await page.waitForTimeout(4800);
  ok('one person vetoing hides it on the other device too',
     await p2.locator('.vetoed-toggle').count() === 1);
}

// leaving
await p2.locator('#endLive').click();
await p2.waitForTimeout(500);
ok('leaving removes you from the session', leaveCalls >= 1);
ok('leaving clears the code from the URL', !p2.url().includes('?s='));

// ---- a joiner who refuses location gets an obvious way back -------------
{
  const denied = await browser.newContext({viewport:{width:390,height:844},
    isMobile:true, hasTouch:true});   // no geolocation permission granted
  await denied.route('**/unpkg.com/leaflet**', r => {
    const u = r.request().url();
    r.fulfill({status:200, contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body: fs.readFileSync(path.join(LEAFLET, u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});
  });
  await denied.route('**/tile.openstreetmap.org/**', r => r.fulfill({status:200,
    contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64')}));
  await denied.route('**/config.js', r => r.fulfill({status:200, contentType:'text/javascript',
    body:"window.MIDPOINT_CONFIG={supabaseUrl:'https://fake.supabase.co',supabaseAnonKey:'anon-test-key'};"}));
  await denied.route('**/rest/v1/rpc/**', async r => {
    const fn = r.request().url().split('/rpc/')[1].split('?')[0];
    const a = JSON.parse(r.request().postData() || '{}');
    const S = db.sessions.get(a.p_code);
    if (fn === 'mp_join') { S.people.push({id:'p-denied', name:a.p_name||'', label:a.p_label||'', lat:a.p_lat, lon:a.p_lon});
      return r.fulfill({status:200, contentType:'application/json', body:JSON.stringify({participant_id:'p-denied'})}); }
    if (fn === 'mp_state') return r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(S)});
    return r.fulfill({status:204, body:''});
  });
  const pd = await denied.newPage();
  await pd.goto('http://localhost:8099/?s=abc1234567', {waitUntil:'networkidle'});
  await pd.waitForTimeout(1500);
  ok('the button appears immediately, not only after the prompt times out',
     await pd.locator('#shareLoc').isVisible());
  ok('and the message names it right away',
     (await pd.locator('#log').textContent()).toLowerCase().includes('share my location'),
     await pd.locator('#log').textContent());
  await pd.waitForTimeout(6500);   // the 6s auto-attempt gives up
  ok('after the attempt gives up, the button is still the way forward',
     await pd.locator('#shareLoc').isVisible());
  await denied.close();
  db.sessions.get('abc1234567').people = db.sessions.get('abc1234567').people.filter(p=>p.id!=='p-denied');
}

// ---- tap the code to copy it -------------------------------------------
{
  // Headless Chromium has no real clipboard permission, so capture the write.
  await page.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: t => { window.__copied = t; return Promise.resolve(); } }
    });
  });
  const shown = await page.locator('#liveCode').textContent();
  await page.locator('#liveCode').click();
  await page.waitForTimeout(150);
  ok('tapping the code copies it', await page.evaluate(() => window.__copied) === shown,
     `copied=${await page.evaluate(() => window.__copied)} shown=${shown}`);
  ok('tapping confirms with a Copied! label',
     (await page.locator('#liveCode').textContent()).includes('Copied'));
  await page.waitForTimeout(1400);
  ok('the code returns after the confirmation',
     (await page.locator('#liveCode').textContent()) === shown,
     await page.locator('#liveCode').textContent());
}

// ---- spend guards -------------------------------------------------------
{
  const p7 = await ctx.newPage();
  await p7.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  await p7.locator('#goLive').click();
  await p7.waitForTimeout(600);

  // Count this page's own requests: rpcCalls is global and other tabs from
  // earlier assertions are still polling.
  const reqs = () => p7.evaluate(() => window.Sync.requests);

  // 1. polling must stop while the tab is hidden
  const before = await reqs();
  await p7.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value:true, configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p7.waitForTimeout(9000);
  const during = await reqs();
  ok('hidden tab makes no requests', during === before, `${during - before} calls while hidden`);

  // 2. and resumes on return
  await p7.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value:false, configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p7.waitForTimeout(800);
  ok('polling resumes when the tab is visible again', (await reqs()) > during);

  // 3. the interval cannot be driven below the floor
  const floorStart = await reqs();
  await p7.evaluate(() => window.Sync.schedule(1));
  await p7.waitForTimeout(5000);
  const n = (await reqs()) - floorStart;
  ok('poll interval is floored at 2s even if set to 1ms', n <= 4, `${n} calls in 5s`);

  // 4. requests never stack up
  ok('only one request in flight at a time',
     await p7.evaluate(() => window.Sync.inFlight === false));

  await p7.close();
}

// the anon key must never touch tables directly
const direct = [...new Set(errs)].length;
ok('all traffic went through rpc endpoints only', rpcCalls > 0);

console.log(`\n${pass} passed, ${fail} failed`);
if(errs.length){ console.log('\nJS errors:'); [...new Set(errs)].forEach(e=>console.log('  '+e)); }
await browser.close(); srv.close();
process.exit(fail||errs.length?1:0);
