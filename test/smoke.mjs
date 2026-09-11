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
    dests.map(c => { const v = byCoord.get(c); return v ? v[4][pi] : 999; }));
  r.fulfill({status:200, contentType:'application/json', body: JSON.stringify({code:'Ok', durations})});
});

const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
page.on('console', m => { if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });

let pass=0, fail=0;
const ok=(n,c,extra='')=>{ c?(pass++,console.log('  ok   '+n)):(fail++,console.log('  FAIL '+n+(extra?'  | '+extra:''))); };

await page.goto('http://localhost:8099/', {waitUntil:'networkidle'});

ok('page loads with 2 empty person rows', await page.locator('.person').count()===2);
ok('map container rendered tiles', calls.tiles>0, `tiles=${calls.tiles}`);
ok('coffee selected by default', await page.locator('.chip.on').first().textContent().then(t=>t.includes('Coffee')));

// fill in two people
const rows = page.locator('.person');
await rows.nth(0).locator('.nm').fill('Sal');
await rows.nth(0).locator('.lc').fill('Wicker Park, Chicago');
await rows.nth(0).locator('.lc').press('Tab');
await page.waitForTimeout(300);
await rows.nth(1).locator('.nm').fill('Dana');
await rows.nth(1).locator('.lc').fill('Hyde Park, Chicago');
await rows.nth(1).locator('.lc').press('Tab');
await page.waitForTimeout(400);

ok('both locations geocoded', calls.nominatim===2, `nominatim calls=${calls.nominatim}`);
ok('geocode status shown to user',
   (await rows.nth(0).locator('.status').textContent()).includes('Wicker Park'));

// add people up to the cap
await page.locator('#addPerson').click();
await page.locator('#addPerson').click();
ok('can reach 4 people', await page.locator('.person').count()===4);
ok('Add button disabled at the cap', await page.locator('#addPerson').isDisabled());
await page.locator('.person').nth(3).locator('.rm').click();
await page.locator('.person').nth(2).locator('.rm').click();
ok('removing a person works', await page.locator('.person').count()===2);

// search
await page.locator('#find').click();
await page.waitForSelector('.venue', {timeout:8000});

ok('overpass queried once', calls.overpass===1, `overpass=${calls.overpass}`);
ok('OSRM matrix queried exactly once (not per-pair)', calls.osrm===1, `osrm=${calls.osrm}`);
ok('results rendered', await page.locator('.venue').count()>0);

const first = await page.locator('.venue').first().locator('.vname').textContent();
ok('fairest venue ranks #1, not the closest-to-one-person', first==='Fair Grounds', `got "${first}"`);

const lop = page.locator('.venue', {hasText:'Lopsided Latte'});
ok('lopsided venue still listed, ranked lower', await lop.count()===1);

ok('per-person fairness bars = 2', await page.locator('.venue').first().locator('.fairrow').count()===2);
const tms = await page.locator('.venue').first().locator('.tm').allTextContents();
ok('real drive times shown, no "~" estimate marker', tms.every(t=>!t.includes('~')), tms.join(' / '));
ok('drive time matches the mocked 600s = 10 min', tms[0].trim()==='10 min', tms[0]);

const mystery = page.locator('.venue', {hasText:'Mystery Mug'});
ok('venue with no hours shows "Hours unknown"',
   (await mystery.locator('.vmeta').textContent()).includes('Hours unknown'));
ok('venue with $$$ shows a price pill',
   (await page.locator('.venue',{hasText:'Pricey Perk'}).locator('.vmeta').textContent()).includes('$$$'));

// open-now filter must not drop unknown-hours venues
const before = await page.locator('.venue').count();
await page.locator('#openNow').click();
await page.locator('#find').click();
await page.waitForTimeout(900);
const after = await page.locator('.venue').count();
ok('open-now keeps unknown-hours venues',
   await page.locator('.venue',{hasText:'Mystery Mug'}).count()===1);
ok('open-now drops the genuinely-closed one',
   await page.locator('.venue',{hasText:'Shuttered Bean'}).count()===0, `before=${before} after=${after}`);
await page.locator('#openNow').click();

// voting
await page.locator('.venue').first().locator('.vote.up').click();
await page.waitForTimeout(150);
ok('vote registers in tally',
   (await page.locator('.venue').first().locator('.tally').textContent()).trim().startsWith('1👍'));
ok('vote button shows active state',
   await page.locator('.venue').first().locator('.vote.up').getAttribute('class').then(c=>c.includes('on')));

// URL state round-trip
const url = page.url();
ok('session encoded into URL hash', url.includes('#') && url.length>60);
const p2 = await ctx.newPage();
await p2.goto(url, {waitUntil:'networkidle'});
await p2.waitForTimeout(400);
ok('shared link restores both people', await p2.locator('.person').count()===2);
ok('shared link restores names',
   (await p2.locator('.person').nth(1).locator('.nm').inputValue())==='Dana');
ok('shared link restores coordinates (no re-geocoding needed)', calls.nominatim===2,
   `nominatim total=${calls.nominatim}`);

// straight-line fallback
await p2.locator('#mode').selectOption('straight');
await p2.locator('#find').click();
await p2.waitForSelector('.venue', {timeout:8000});
const km = await p2.locator('.venue').first().locator('.tm').first().textContent();
ok('straight-line mode reports distance not minutes', /km|m$/.test(km.trim()), km);

console.log(`\n${pass} passed, ${fail} failed`);
if(errs.length){ console.log('\nJS errors:'); [...new Set(errs)].forEach(e=>console.log('  '+e)); }
await page.screenshot({path:'shot-results.png', fullPage:false});
await browser.close(); srv.close();
process.exit(fail||errs.length?1:0);
