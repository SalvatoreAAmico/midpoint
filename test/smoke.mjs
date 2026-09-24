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
  ['Starbucks',      41.8518,-87.6354, {amenity:'cafe', brand:'Starbucks', opening_hours:'24/7'}, [605, 615]],
  ['Dunkin',         41.8515,-87.6351, {amenity:'cafe', opening_hours:'24/7'},                    [602, 612]],
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
for (let i=0;i<6;i++) await page.locator('#addPerson').click();
ok('can reach 8 people', await page.locator('.person').count()===8);
ok('Add button disabled at the cap', await page.locator('#addPerson').isDisabled());
ok('every person gets a distinct colour', await page.locator('.person .dot').evaluateAll(
     els => new Set(els.map(e=>e.style.background)).size === 8));
for (let i=7;i>=2;i--) await page.locator('.person').nth(i).locator('.rm').click();
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

// ---- independent-only (default on) -------------------------------------
ok('Independent only is on by default',
   (await page.locator('#noChains').getAttribute('class')).includes('on'));
ok('brand-tagged chain hidden by default',
   await page.locator('.venue', {hasText:'Starbucks'}).count() === 0);
ok('name-matched chain hidden by default',
   await page.locator('.venue', {hasText:'Dunkin'}).count() === 0);
ok('independents still shown',
   await page.locator('.venue', {hasText:'Fair Grounds'}).count() === 1);
ok('log reports how many chains were hidden',
   (await page.locator('#log').textContent()).includes('2 chains hidden'),
   await page.locator('#log').textContent());

await page.locator('#noChains').click();
await page.locator('#find').click();
await page.waitForTimeout(900);
ok('turning the filter off brings chains back',
   await page.locator('.venue', {hasText:'Starbucks'}).count() === 1);
ok('a shown chain is labelled as one',
   (await page.locator('.venue',{hasText:'Starbucks'}).locator('.vmeta').textContent()).includes('Chain'));
await page.locator('#noChains').click();
await page.locator('#find').click();
await page.waitForTimeout(900);

// ---- category search ----------------------------------------------------
ok('search box present', await page.locator('#catSearch').count()===1);
ok('no results panel before typing', await page.locator('#catResults').isHidden());

await page.locator('#catSearch').fill('pizza');
await page.waitForTimeout(200);
ok('typing shows matches', await page.locator('.cat-hit').count() > 0);
ok('pizza is the first match',
   (await page.locator('.cat-hit').first().textContent()).includes('Pizza'),
   await page.locator('.cat-hit').first().textContent());

await page.locator('.cat-hit').first().click();
await page.waitForTimeout(200);
ok('picking a result clears the search box',
   (await page.locator('#catSearch').inputValue())==='');
ok('picked category becomes a selected chip',
   (await page.locator('.chip.on').allTextContents()).some(t=>t.includes('Pizza')),
   (await page.locator('.chip.on').allTextContents()).join('|'));
ok('results panel hides again', await page.locator('#catResults').isHidden());

// a long-tail want must resolve upward, never to a dead end
await page.locator('#catSearch').fill('axe throwing');
await page.waitForTimeout(200);
ok('"axe throwing" offers bars rather than nothing',
   (await page.locator('.cat-hit').allTextContents()).some(t=>t.includes('Drinks')),
   (await page.locator('.cat-hit').allTextContents()).join('|'));

// a genuine miss explains itself
await page.locator('#catSearch').fill('zzzqqq');
await page.waitForTimeout(200);
ok('an unmatched search explains itself', await page.locator('.no-cat').count()===1);
ok('and suggests broader words',
   (await page.locator('.no-cat').textContent()).includes('drinks'));
await page.locator('#catSearch').fill('');
await page.waitForTimeout(150);

// Enter picks the top match
await page.locator('#catSearch').fill('sushi');
await page.waitForTimeout(200);
await page.locator('#catSearch').press('Enter');
await page.waitForTimeout(200);
ok('Enter selects the first result',
   (await page.locator('.chip.on').allTextContents()).some(t=>t.includes('Sushi')),
   (await page.locator('.chip.on').allTextContents()).join('|'));

// a cuisine search must compile into the Overpass query
let lastQuery = '';
await page.route('**/api/interpreter', async r => {
  lastQuery = decodeURIComponent(r.request().postData()||'');
  await r.fallback();
});
await page.locator('#find').click();
await page.waitForTimeout(1500);
ok('cuisine categories compile into the Overpass query',
   lastQuery.includes('["cuisine"~"sushi|japanese",i]'), lastQuery.slice(0,200));

// reset selection for the assertions that follow
for (const t of ['Pizza','Sushi']) {
  const chip = page.locator('.chip.on', {hasText:t});
  if (await chip.count()) await chip.first().click();
}
await page.waitForTimeout(150);

// ---- feeling lucky ------------------------------------------------------
ok('lucky chip present', await page.locator('#lucky').count() === 1);
const beforeCats = await page.locator('.chip.on').allTextContents();
await page.locator('#lucky').click();
await page.waitForSelector('.venue', {timeout:8000});
await page.waitForTimeout(400);
const afterCats = (await page.locator('.chip.on').allTextContents()).filter(t=>!t.includes('🎲')&&!t.includes('Independent'));
ok('a roll selects 3 activity types', afterCats.length === 3, afterCats.join('|'));
ok('lucky chip switches to Re-roll',
   (await page.locator('#lucky').textContent()).includes('Re-roll'));
ok('lucky results are still shown', await page.locator('.venue').count() > 0);
ok('log explains the roll',
   (await page.locator('#log').textContent()).includes('shuffled from'),
   await page.locator('#log').textContent());

const roll1 = await page.locator('.chip.on').allTextContents();
await page.locator('#lucky').click();
await page.waitForTimeout(1200);
const roll2 = await page.locator('.chip.on').allTextContents();
ok('re-rolling changes the selection', roll1.join() !== roll2.join(), roll1.join()+' -> '+roll2.join());

// lucky must not abandon fairness
const luckyTimes = await page.locator('.venue').first().locator('.tm').allTextContents();
ok('lucky picks are still drawn from fair spots',
   luckyTimes.every(t => parseInt(t) <= 25), luckyTimes.join('/'));

// picking a category by hand leaves lucky mode
await page.locator('.chip', {hasText:'Coffee'}).first().click();
ok('manual category choice exits lucky mode',
   (await page.locator('#lucky').textContent()).includes('Feeling lucky'));

// a midpoint surrounded only by chains must still return something
{
  const saved = VENUES.splice(0, VENUES.length);
  VENUES.push(['Starbucks', 41.8518,-87.6354, {amenity:'cafe', brand:'Starbucks', opening_hours:'24/7'}, [605,615]],
              ['Dunkin',    41.8515,-87.6351, {amenity:'cafe', opening_hours:'24/7'},                    [602,612]]);
  byCoord.clear(); VENUES.forEach(v => byCoord.set(`${v[2].toFixed(5)},${v[1].toFixed(5)}`, v));
  await page.locator('#find').click();
  await page.waitForTimeout(1200);
  ok('chain-only area still returns results rather than an empty list',
     await page.locator('.venue').count() > 0);
  ok('and says why', (await page.locator('#log').textContent()).includes('Only chains'),
     await page.locator('#log').textContent());
  VENUES.splice(0, VENUES.length, ...saved);
  byCoord.clear(); VENUES.forEach(v => byCoord.set(`${v[2].toFixed(5)},${v[1].toFixed(5)}`, v));
}

// restore a known state for the assertions that follow
await page.locator('#find').click();
await page.waitForTimeout(900);

// open-now filter must not drop unknown-hours venues
const before = await page.locator('.venue').count();
await page.locator('#whenDay').selectOption('now');
await page.locator('#find').click();
await page.waitForTimeout(900);
const after = await page.locator('.venue').count();
ok('open-now keeps unknown-hours venues',
   await page.locator('.venue',{hasText:'Mystery Mug'}).count()===1);
ok('open-now drops the genuinely-closed one',
   await page.locator('.venue',{hasText:'Shuttered Bean'}).count()===0, `before=${before} after=${after}`);

// a specific day + time, not just "now"
ok('time input appears once a weekday is chosen', await (async()=>{
  await page.locator('#whenDay').selectOption('3');   // Wednesday
  return !(await page.locator('#whenTime').isHidden());
})());
await page.locator('#whenTime').fill('23:00');        // Wed 11pm
await page.locator('#find').click();
await page.waitForTimeout(1000);
ok('Wed 11pm excludes a Mo-Fr 08:00-18:00 cafe',
   await page.locator('.venue',{hasText:'Shuttered Bean'}).count()===0);
ok('Wed 11pm keeps a 24/7 cafe',
   await page.locator('.venue',{hasText:'Fair Grounds'}).count()===1);
ok('pill names the chosen time, not "now"',
   (await page.locator('.venue',{hasText:'Fair Grounds'}).locator('.vmeta').textContent()).includes('Wed 11pm'),
   await page.locator('.venue',{hasText:'Fair Grounds'}).locator('.vmeta').textContent());
await page.locator('#whenDay').selectOption('');

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


console.log(`\n${pass} passed, ${fail} failed`);
if(errs.length){ console.log('\nJS errors:'); [...new Set(errs)].forEach(e=>console.log('  '+e)); }
await page.screenshot({path:'shot-results.png', fullPage:false});
await browser.close(); srv.close();
process.exit(fail||errs.length?1:0);
