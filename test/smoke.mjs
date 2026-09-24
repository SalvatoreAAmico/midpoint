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

/* Web fonts are not reachable from the test sandbox and would log a console
   error that the suite treats as a failure. Serve them as empty. */
const stubFonts = async c => {
  await c.route('**/fonts.googleapis.com/**', r =>
    r.fulfill({status:200, contentType:'text/css', body:''}));
  await c.route('**/fonts.gstatic.com/**', r =>
    r.fulfill({status:200, contentType:'font/woff2', body:''}));
};
const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
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

// ---- hidden means hidden ------------------------------------------------
ok('elements hidden by attribute are actually hidden', await page.evaluate(() =>
  ['#catResults','#geoHelp','#outlier','#whenTime','#liveBar']
    .filter(sel => { const e=document.querySelector(sel);
      return e && e.hasAttribute('hidden') && getComputedStyle(e).display !== 'none'; })
    .join(',') === ''), await page.evaluate(() =>
  ['#catResults','#geoHelp','#outlier','#whenTime','#liveBar']
    .filter(sel => { const e=document.querySelector(sel);
      return e && e.hasAttribute('hidden') && getComputedStyle(e).display !== 'none'; }).join(',')));

// ---- the located row always settles on a real label ---------------------
{
  const odd = await browser.newContext({viewport:{width:390,height:844}, isMobile:true,
    hasTouch:true, permissions:['geolocation'], geolocation:{latitude:41.9,longitude:-87.63}});
await stubFonts(odd);
  await odd.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
    r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
  await odd.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  // a reverse lookup that returns nothing usable
  await odd.route('**/nominatim.openstreetmap.org/**', r =>
    r.fulfill({status:200, contentType:'application/json', body:'[]'}));
  const po = await odd.newPage();
  await po.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  await po.locator('.person').nth(0).locator('.loc').click();
  await po.waitForTimeout(1200);
  ok('an unusable reverse lookup still settles the field',
     (await po.locator('.person').nth(0).locator('.lc').inputValue()) === 'My location',
     await po.locator('.person').nth(0).locator('.lc').inputValue());
  ok('and never strands it on "Locating…"',
     !(await po.locator('.person').nth(0).locator('.lc').inputValue()).includes('Locating'));
  await odd.close();
}

// ---- blocked location ---------------------------------------------------
ok('no blocked-location help when location works', await page.locator('#geoHelp').isHidden());
{
  // Simulate iOS after a refusal: the call fails instantly with code 1.
  const blocked = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
await stubFonts(blocked);
  await blocked.route('**/unpkg.com/leaflet**', r => {
    const u = r.request().url();
    r.fulfill({status:200, contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body: fs.readFileSync(path.join(LEAFLET, u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});
  });
  await blocked.route('**/tile.openstreetmap.org/**', r => r.fulfill({status:200,
    contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  await blocked.route('**/nominatim.openstreetmap.org/**', r => {
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q')||'').toLowerCase().trim();
    const hit = PLACES[q];
    r.fulfill({status:200, contentType:'application/json',
      body: JSON.stringify(hit ? [{lat:String(hit.lat), lon:String(hit.lon), display_name:hit.display_name}] : [])});
  });
  await blocked.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) =>
      err({ code: 1, message: 'User denied Geolocation' });
  });
  const pb = await blocked.newPage();
  await pb.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  await pb.locator('.person').nth(0).locator('.loc').click();
  await pb.waitForTimeout(400);

  ok('a refusal shows the recovery instructions', await pb.locator('#geoHelp').isVisible());
  ok('instructions name the aA button, not clearing all data',
     (await pb.locator('#geoHelp').textContent()).includes('aA'));
  ok('and say typing a place works instead',
     (await pb.locator('#geoHelp').textContent()).toLowerCase().includes('type a neighborhood'));
  ok('focus moves to the box that still works',
     await pb.evaluate(() => document.activeElement?.classList.contains('lc')));
  ok('the row status points at the same box',
     (await pb.locator('.person').nth(0).locator('.status').textContent()).includes('type a neighborhood'),
     await pb.locator('.person').nth(0).locator('.status').textContent());

  // typing a place must still fully work while blocked
  await pb.locator('.person').nth(0).locator('.lc').fill('Wicker Park, Chicago');
  await pb.locator('.person').nth(0).locator('.lc').press('Tab');
  await pb.waitForTimeout(600);
  ok('typing a place works even with location blocked',
     (await pb.locator('.person').nth(0).locator('.status').textContent()).includes('Wicker Park'),
     await pb.locator('.person').nth(0).locator('.status').textContent());
  await blocked.close();
}

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
// Focus is kept deliberately, so the panel falls back to the browse list and
// you can pick a second category without tapping the box again.
ok('the panel stays open for a second pick',
   !(await page.locator('#catResults').isHidden()));
ok('and falls back to browsing everything',
   await page.locator('.cat-head').count() === 1);
await page.locator('body').click({position:{x:5,y:5}});
await page.waitForTimeout(350);
ok('tapping away then closes it', await page.locator('#catResults').isHidden());

// a long-tail want must resolve upward, never to a dead end
await page.locator('#catSearch').fill('axe throwing');
await page.waitForTimeout(200);
ok('"axe throwing" finds Games rather than nothing',
   (await page.locator('.cat-hit').first().textContent()).includes('Games'),
   (await page.locator('.cat-hit').allTextContents()).join('|'));

await page.locator('#catSearch').fill('level 99');
await page.waitForTimeout(200);
ok('a venue brand with no OSM tag still lands somewhere sensible',
   (await page.locator('.cat-hit').first().textContent()).includes('Games'),
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

// ---- browse everything by tapping the empty search box ------------------
await page.locator('#catSearch').click();
await page.waitForTimeout(250);
ok('tapping the empty search box lists every category',
   await page.locator('.cat-hit').count() > 25,
   String(await page.locator('.cat-hit').count()));
ok('the full list is headed so it reads as a browse, not a result',
   await page.locator('.cat-head').count() === 1);
await page.locator('#catSearch').fill('pizza');
await page.waitForTimeout(200);
ok('typing narrows it back down',
   await page.locator('.cat-hit').count() < 5,
   String(await page.locator('.cat-hit').count()));
await page.locator('#catSearch').fill('');
await page.locator('body').click({position:{x:5,y:5}});
await page.waitForTimeout(350);
ok('tapping away closes the list', await page.locator('#catResults').isHidden());

// ---- directions open in the chosen maps app -----------------------------
{
  ok('there is no maps setting anywhere on the page',
     await page.locator('#maps').count() === 0 && await page.locator('#mapsPref').count() === 0);
  ok('the sheet is closed until asked for', await page.locator('#mapsSheet').isHidden());

  const name = await page.locator('.venue').first().locator('.vname').textContent();
  await page.locator('.venue').first().locator('.maplink').click();
  await page.waitForTimeout(250);
  ok('tapping Directions asks which app', await page.locator('#mapsSheet').isVisible());
  ok('and names the place being opened',
     (await page.locator('#msTitle').textContent()).includes(name),
     await page.locator('#msTitle').textContent());
  ok('all three apps are offered', await page.locator('.ms-opt').count() === 3);
  ok('Apple Maps points at Apple',
     (await page.locator('.ms-opt[data-app=apple]').getAttribute('href')).includes('maps.apple.com'));
  ok('Google Maps points at Google',
     (await page.locator('.ms-opt[data-app=google]').getAttribute('href')).includes('google.com/maps'));
  ok('OpenStreetMap points at OSM',
     (await page.locator('.ms-opt[data-app=osm]').getAttribute('href')).includes('openstreetmap.org'));

  // choosing remembers, so the next tap leads with it
  await page.locator('.ms-opt[data-app=osm]').click();
  await page.waitForTimeout(200);
  ok('choosing closes the sheet', await page.locator('#mapsSheet').isHidden());
  ok('and is remembered on the device',
     await page.evaluate(() => localStorage.getItem('midpoint.maps')) === 'osm');

  await page.locator('.venue').first().locator('.maplink').click();
  await page.waitForTimeout(250);
  ok('the next tap marks the last choice',
     await page.locator('.ms-opt.last').getAttribute('data-app') === 'osm');

  await page.locator('#mapsSheet .ms-cancel').click();
  await page.waitForTimeout(200);
  ok('Cancel closes it', await page.locator('#mapsSheet').isHidden());

  await page.locator('.venue').first().locator('.maplink').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape closes it', await page.locator('#mapsSheet').isHidden());
}

ok('the chains filter is named in plain words',
   (await page.locator('#noChains').textContent()).trim() === 'No chains',
   await page.locator('#noChains').textContent());

// ---- cuisine sub-chips --------------------------------------------------
ok('no cuisine row until food is in play',
   await page.locator('.subchips').count() === 0);
await page.locator('.chip', {hasText:'Food'}).first().click();
await page.waitForTimeout(200);
ok('choosing Food reveals cuisines', await page.locator('.subchips .chip.sub').count() > 5);
await page.locator('.chip.sub', {hasText:'Pizza'}).click();
await page.waitForTimeout(200);
ok('picking a cuisine selects it',
   (await page.locator('.chip.sub.on').allTextContents()).some(t=>t.includes('Pizza')));
ok('and drops the broader Food, which would swallow it',
   !(await page.locator('.chip.on').allTextContents()).some(t=>t.trim().startsWith('🍽')),
   (await page.locator('.chip.on').allTextContents()).join('|'));
await page.locator('.chip.sub', {hasText:'Pizza'}).click();
await page.waitForTimeout(200);
ok('deselecting the last cuisine restores Food',
   (await page.locator('.chip.on').allTextContents()).some(t=>t.includes('Food')),
   (await page.locator('.chip.on').allTextContents()).join('|'));
await page.locator('.chip', {hasText:'Food'}).first().click();
await page.waitForTimeout(200);

// ---- feeling lucky ------------------------------------------------------
ok('lucky chip present', await page.locator('#lucky').count() === 1);
const beforeCats = await page.locator('.chip.on').allTextContents();
await page.locator('#lucky').click();
await page.waitForSelector('.venue', {timeout:8000});
await page.waitForTimeout(400);
const afterCats = (await page.locator('.chip.on').allTextContents()).filter(t=>!t.includes('Surprise')&&!t.includes('Re-roll')&&!t.includes('No chains'));
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
   (await page.locator('#lucky').textContent()).includes('Surprise us'));

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
const firstName = await page.locator('.venue').first().locator('.vname').textContent();
await page.locator('.venue').first().locator('.vote.up').click();
await page.waitForTimeout(150);
ok('vote registers in tally',
   (await page.locator('.venue').first().locator('.tally').textContent()).replace(/\u00a0/g,' ').trim().startsWith('1 yes'));
ok('vote button shows active state',
   await page.locator('.venue').first().locator('.vote.up').getAttribute('class').then(c=>c.includes('on')));

// ---- a thumbs-down rules a place out ------------------------------------
{
  const before = await page.locator('.venue').count();
  const second = await page.locator('.venue').nth(1).locator('.vname').textContent();
  await page.locator('.venue').nth(1).locator('.vote.down').click();
  await page.waitForTimeout(250);
  ok('a vetoed venue disappears from the list',
     await page.locator('.venue', {hasText:second}).count() === 0, second);
  ok('the list shrinks by exactly one',
     await page.locator('.venue').count() === before - 1);
  ok('and the veto is undoable, not destructive',
     await page.locator('.vetoed-toggle').count() === 1);

  await page.locator('.vetoed-toggle').click();
  await page.waitForTimeout(200);
  ok('showing them again brings it back, struck through',
     await page.locator('.venue.vetoed', {hasText:second}).count() === 1);
  await page.locator('.venue.vetoed', {hasText:second}).locator('.vote.down').click();
  await page.waitForTimeout(250);
  ok('un-voting restores it fully',
     await page.locator('.venue.vetoed').count() === 0);
}

// ---- a winner is declared once everyone has voted -----------------------
{
  ok('no winner while only one person has voted',
     await page.locator('.winner').count() === 0);
}

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
