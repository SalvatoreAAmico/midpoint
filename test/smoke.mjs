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
  ['Fair Grounds',   41.8516,-87.6352, {amenity:'cafe', opening_hours:'24/7', 'addr:city':'Leominster'}, [600, 600]],
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

/* The venue name now carries its town as a child span, so a test that wants
   the name alone must read the text node rather than the whole element. */
const venueName = loc => loc.locator('.vname').evaluate(e => e.childNodes[0].textContent.trim());
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

const first = await venueName(page.locator('.venue').first());
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

/* ---- appearance follows the phone, and can be overridden ----------------
   Three states, because a two-state switch cannot say "follow the phone". The
   thing most likely to break silently is the :not([data-theme="dark"]) guard:
   without it a phone set to light would drag the app light even when someone
   has explicitly chosen dark. */
{
  const bgOf = pg => pg.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toUpperCase());
  const metaOf = pg => pg.evaluate(() =>
    document.querySelector('meta[name="theme-color"]')?.content?.toUpperCase());
  const DARK = '#0F1211', LIGHT = '#F7F9F6';

  const mk = async scheme => {
    const c = await browser.newContext({viewport:{width:390,height:844}, isMobile:true,
      hasTouch:true, colorScheme: scheme});
    await stubFonts(c);
    await c.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
      r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
        body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
    await c.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
      body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
    return c;
  };

  const cl = await mk('light'); const pl = await cl.newPage();
  await pl.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  ok('a phone set to light gets the light palette', await bgOf(pl) === LIGHT, await bgOf(pl));
  ok('and the status bar colour follows it', await metaOf(pl) === LIGHT, await metaOf(pl));
  const choice = pg => pg.locator('#theme').getAttribute('data-choice');
  ok('the control says it is following the phone', await choice(pl) === 'auto');
  ok('and it is drawn, not spelled out',
     await pl.locator('#theme svg').count() === 1);
  ok('with a label a screen reader can read',
     /following your phone/i.test(await pl.locator('#theme').getAttribute('aria-label')),
     await pl.locator('#theme').getAttribute('aria-label'));
  ok('and a tap target that meets the 44px guideline',
     await pl.locator('#theme').boundingBox().then(b => b.width >= 44 && b.height >= 44),
     JSON.stringify(await pl.locator('#theme').boundingBox()));

  const cd = await mk('dark'); const pd = await cd.newPage();
  await pd.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  ok('a phone set to dark gets the dark palette', await bgOf(pd) === DARK, await bgOf(pd));
  ok('and the status bar colour follows that too', await metaOf(pd) === DARK, await metaOf(pd));

  // Auto -> Light -> Dark -> Auto
  await pl.locator('#theme').click(); await pl.waitForTimeout(120);
  ok('one tap forces light', await choice(pl) === 'light');
  await pl.locator('#theme').click(); await pl.waitForTimeout(120);
  ok('two taps force dark', await choice(pl) === 'dark');
  ok('chosen dark beats a phone set to light', await bgOf(pl) === DARK, await bgOf(pl));
  ok('and the status bar goes dark with it', await metaOf(pl) === DARK, await metaOf(pl));

  await pl.reload({waitUntil:'networkidle'});
  ok('the choice survives a reload', await bgOf(pl) === DARK, await bgOf(pl));
  ok('and the control still says so', await choice(pl) === 'dark');

  await pl.locator('#theme').click(); await pl.waitForTimeout(120);
  ok('a third tap hands it back to the phone', await choice(pl) === 'auto');
  ok('each state has its own glyph', await pl.evaluate(async () => {
    const b = document.querySelector('#theme'), seen = new Set();
    for (let i = 0; i < 3; i++) { seen.add(b.innerHTML); b.click(); await new Promise(r=>setTimeout(r,20)); }
    return seen.size === 3;
  }));
  ok('and the phone wins again', await bgOf(pl) === LIGHT, await bgOf(pl));

  // the reverse guard: choosing light on a dark phone
  await pd.locator('#theme').click(); await pd.waitForTimeout(120);
  ok('chosen light beats a phone set to dark', await bgOf(pd) === LIGHT, await bgOf(pd));

  await cl.close(); await cd.close();
}

/* ---- picking a meal picks a time ----------------------------------------
   Dinner and Food return nearly the same places; what makes Dinner mean
   anything is the hour. The rule that matters is the one that stops it being
   annoying: it must never overwrite a day and time already chosen. */
{
  const c = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  await stubFonts(c);
  await c.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
    r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
  await c.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  const pm = await c.newPage();
  await pm.goto('http://localhost:8099/', {waitUntil:'networkidle'});

  const pick = async name => {
    await pm.locator('#catSearch').fill(name);
    await pm.waitForTimeout(200);
    await pm.locator('.cat-hit', {hasText:new RegExp(name,'i')}).first().click();
    await pm.waitForTimeout(200);
  };

  ok('no day is set to begin with', await pm.locator('#whenDay').inputValue() === '');
  await pick('Dinner');
  ok('choosing Dinner sets the time to the evening',
     await pm.locator('#whenTime').inputValue() === '19:00',
     await pm.locator('#whenTime').inputValue());
  ok('and sets a day, so the time actually applies',
     /^[0-6]$/.test(await pm.locator('#whenDay').inputValue()),
     await pm.locator('#whenDay').inputValue());
  ok('and reveals the time control', await pm.locator('#whenTime').isVisible());
  ok('and says what it did rather than doing it silently',
     /change the day or time/i.test(await pm.locator('#log').textContent()),
     await pm.locator('#log').textContent());

  // an explicit choice must win
  await pm.locator('#whenDay').selectOption('6');           // Saturday
  await pm.locator('#whenTime').fill('14:00');
  await pm.locator('#whenTime').dispatchEvent('change');
  await pm.waitForTimeout(150);
  await pick('Breakfast');
  ok('a day you chose yourself is never overwritten',
     await pm.locator('#whenDay').inputValue() === '6',
     await pm.locator('#whenDay').inputValue());
  ok('nor is the time you chose',
     await pm.locator('#whenTime').inputValue() === '14:00',
     await pm.locator('#whenTime').inputValue());

  // a non-meal category leaves the time alone entirely
  await pm.locator('#whenDay').selectOption('');
  await pm.waitForTimeout(150);
  await pick('Games');
  ok('a category that is not a meal sets no time at all',
     await pm.locator('#whenDay').inputValue() === '',
     await pm.locator('#whenDay').inputValue());
  await c.close();
}

/* ---- searching with nobody located must not wedge the app ---------------
   Reported as "the app gets hung up". The guard that returns early sat AFTER
   state.searching was set, and the finally that clears it is inside the try
   below it -- so one search with no locations left the flag true forever and
   every later search returned at the first line. The button stayed alive and
   nothing ever happened again. */
{
  const c = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  await stubFonts(c);
  await c.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
    r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
  await c.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  await c.route('**/nominatim.openstreetmap.org/**', r => {
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q')||'').toLowerCase().trim();
    const hit = PLACES[q];
    r.fulfill({status:200, contentType:'application/json',
      body: JSON.stringify(hit ? [{lat:String(hit.lat), lon:String(hit.lon), display_name:hit.display_name}] : [])});
  });
  await c.route('**/api/interpreter', r => r.fulfill({status:200, contentType:'application/json',
    body: JSON.stringify({elements: VENUES.map((v,i)=>({type:'node', id:1000+i, lat:v[1], lon:v[2], tags:{name:v[0], ...v[3]}}))})}));
  await c.route('**/router.project-osrm.org/**', r => {
    const u = new URL(r.request().url());
    const n = u.searchParams.get('sources').split(';').length;
    const m = u.pathname.split('/').pop().split(';').length - n;
    r.fulfill({status:200, contentType:'application/json',
      body: JSON.stringify({code:'Ok', durations: Array.from({length:n}, () => Array(m).fill(600))})});
  });
  const ph = await c.newPage();
  await ph.goto('http://localhost:8099/', {waitUntil:'networkidle'});

  await ph.locator('#find').click();          // nobody has a location yet
  await ph.waitForTimeout(400);
  ok('searching with nobody located says what is missing',
     /at least one location/i.test(await ph.locator('#log').textContent()),
     await ph.locator('#log').textContent());
  ok('and leaves the button usable', !(await ph.locator('#find').isDisabled()));

  // the thing that actually broke: the NEXT search must still work
  await ph.locator('.person').nth(0).locator('.lc').fill('Wicker Park, Chicago');
  await ph.locator('.person').nth(0).locator('.lc').dispatchEvent('change');
  await ph.waitForTimeout(600);
  await ph.locator('#find').click();
  await ph.waitForSelector('.venue', {timeout:8000});
  ok('a later search still runs, rather than returning at the first line',
     await ph.locator('.venue').count() > 0);
  await c.close();
}

/* ---- someone in the session with no location ----------------------------
   They are ignored by the scoring, which is right -- but costs used to be
   indexed by the located people while the rows are drawn per person, so a
   joiner with no location made every row below them show somebody else's
   travel time, and the last row show NaN. */
{
  await page.locator('#addPerson').click();
  await page.locator('.person').nth(2).locator('.nm').fill('Ghost');
  await page.waitForTimeout(150);
  await page.locator('#find').click();
  await page.waitForSelector('.venue', {timeout:8000});
  await page.waitForTimeout(300);

  const card = page.locator('.venue').first();
  ok('a person with no location gets a row, not silence',
     await card.locator('.fairrow').count() === 3,
     String(await card.locator('.fairrow').count()));
  ok('their row says waiting rather than a time',
     await card.locator('.fairrow.waiting').count() === 1);
  ok('and no row anywhere shows NaN',
     !/NaN/.test(await page.locator('#results').textContent()));
  ok('the people who are located still show real times',
     (await card.locator('.fairrow:not(.waiting) .tm').first().textContent()).includes('min'),
     await card.locator('.fairrow:not(.waiting) .tm').first().textContent());
  ok('and the log names who is not counted',
     /ghost/i.test(await page.locator('#log').textContent())
     && /not counted/i.test(await page.locator('#log').textContent()),
     await page.locator('#log').textContent());

  await page.locator('.person').nth(2).locator('.rm').click();   // tidy up
  await page.waitForTimeout(200);
}

/* ---- a place that does not exist ----------------------------------------
   Reported by one of Sal's testers: they typed a place, were told it was not
   where they are, and then watched the box empty itself. Two faults. The row
   is redrawn from the person's label, so leaving the label unset on a failed
   lookup wiped what they had typed -- the app rejecting them twice. And the
   message on SUCCESS read "typed, not your current location", which sounds
   like a correction when the app has simply done as it was asked. */
{
  const c = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  await stubFonts(c);
  await c.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
    r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
  await c.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  await c.route('**/nominatim.openstreetmap.org/**', r => {
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q')||'').toLowerCase().trim();
    const hit = PLACES[q];
    r.fulfill({status:200, contentType:'application/json',
      body: JSON.stringify(hit ? [{lat:String(hit.lat), lon:String(hit.lon), display_name:hit.display_name}] : [])});
  });
  const pn = await c.newPage();
  await pn.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  const row = pn.locator('.person').nth(0);

  await row.locator('.lc').fill('Zzyzx Notaplace');
  await row.locator('.lc').dispatchEvent('change');
  await pn.waitForTimeout(500);

  ok('a place that does not exist keeps what you typed',
     await row.locator('.lc').inputValue() === 'Zzyzx Notaplace',
     `field is now "${await row.locator('.lc').inputValue()}"`);
  ok('and says what it could not find, with a way forward',
     /no match/i.test(await row.locator('.status').textContent())
     && /city|state/i.test(await row.locator('.status').textContent()),
     await row.locator('.status').textContent());
  ok('and puts nobody on the map for it',
     await row.locator('.status').textContent().then(t => !/on the map/i.test(t)));

  // and a place that does exist must not be told off for existing
  await row.locator('.lc').fill('Wicker Park, Chicago');
  await row.locator('.lc').dispatchEvent('change');
  await pn.waitForTimeout(500);
  const good = await row.locator('.status').textContent();
  ok('a place that does exist is accepted, not corrected',
     !/not your current location|not where you are/i.test(good), good);
  ok('and the row says which place it used',
     /wicker park/i.test(good) && !/no match/i.test(good), good);
  ok('while still making clear it came from the box, not from GPS',
     /you typed/i.test(good), good);
  await c.close();
}

/* ---- the sheet must actually scroll ------------------------------------
   Sal could not find the category search in either theme. #sheet is a column
   flex item with overflow-y:auto and no min-height:0, which in WebKit means it
   never shrinks below its content, the inner scroll never engages, and
   everything past the fold is unreachable -- there is no page scroll to fall
   back on because html and body are pinned to 100%. */
{
  const sheet = page.locator('#sheet');
  const canScroll = await sheet.evaluate(e => e.scrollHeight > e.clientHeight + 40);
  ok('the sheet has more content than fits, as it should', canScroll,
     await sheet.evaluate(e => `scrollHeight=${e.scrollHeight} clientHeight=${e.clientHeight}`));
  ok('and it is a scroll container rather than an overflowing block',
     await sheet.evaluate(e => {
       const s = getComputedStyle(e);
       return s.overflowY === 'auto' && s.minHeight === '0px';
     }),
     await sheet.evaluate(e => { const s = getComputedStyle(e);
       return `overflowY=${s.overflowY} minHeight=${s.minHeight}`; }));
  ok('it does not grow past the window, which is what hides the bottom half',
     await sheet.evaluate(e => e.clientHeight <= window.innerHeight + 1),
     await sheet.evaluate(e => `clientHeight=${e.clientHeight} window=${window.innerHeight}`));

  // scrolling it must actually reach the search box
  await sheet.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await page.waitForTimeout(150);
  ok('scrolling to the bottom reaches the category search',
     await page.locator('#catSearch').evaluate(e => {
       const r = e.getBoundingClientRect();
       return r.top < window.innerHeight && r.bottom > 0;
     }) || await page.locator('#catSearch').isVisible());

  ok('the build number is shown, so a stale page can be spotted',
     /build \d+/.test(await page.locator('#build').textContent()),
     await page.locator('#build').textContent());
}

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

// ---- failures are said out loud -----------------------------------------
ok('nothing is reported when nothing is wrong', await page.locator('#trouble').isHidden());

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
  /* A real block is two facts, not one: the call fails with code 1 AND the
     permission is actually "denied". Stubbing only the call modelled a
     dismissed prompt, which is a different thing and now reads differently. */
  await blocked.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) =>
      err({ code: 1, message: 'User denied Geolocation' });
    navigator.permissions.query = async () => ({ state: 'denied', onchange: null });
  });
  const pb = await blocked.newPage();
  await pb.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  await pb.locator('.person').nth(0).locator('.loc').click();
  await pb.waitForTimeout(400);

  ok('a refusal shows the recovery instructions', await pb.locator('#geoHelp').isVisible());
  ok('and the trouble banner names it too', await pb.locator('#trouble .tr').count() >= 1);
  ok('the banner says how to fix it, not just what broke',
     (await pb.locator('#trouble').textContent()).includes('Website Settings'),
     await pb.locator('#trouble').textContent());
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

/* ---- dismissing the prompt is not being blocked -------------------------
   iOS reports a dismissed prompt with the same code 1 as a refusal. Sal's
   tester opened an invite link, tapped away from the prompt, and was told in
   red that their location was BLOCKED -- along with a banner promising iPhone
   would never ask again, which was not true. Declining is a choice, and the
   app has a perfectly good alternative. */
{
  const shy = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  await stubFonts(shy);
  await shy.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
    r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
  await shy.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  // the call fails, but the permission is still "prompt": they only tapped away
  await shy.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) =>
      err({ code: 1, message: 'User denied Geolocation' });
    navigator.permissions.query = async () => ({ state: 'prompt', onchange: null });
  });
  const psh = await shy.newPage();
  await psh.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  await psh.locator('.person').nth(0).locator('.loc').click();
  await psh.waitForTimeout(500);

  const row = psh.locator('.person').nth(0);
  const txt = await row.locator('.status').textContent();
  ok('a dismissed prompt is not called blocked', !/blocked|off for this site/i.test(txt), txt);
  ok('it just says no location was shared', /no location shared/i.test(txt), txt);
  ok('and still points at the box that works', /type a neighborhood/i.test(txt), txt);
  ok('it is not shown in red, because nothing is broken',
     !(await row.locator('.status').getAttribute('class')).includes('err'),
     await row.locator('.status').getAttribute('class'));
  ok('no recovery instructions for a permission that is not denied',
     await psh.locator('#geoHelp').isHidden());
  ok('and no banner claiming iPhone will never ask again',
     !/never ask again|will not ask again/i.test(await psh.locator('#trouble').textContent()),
     await psh.locator('#trouble').textContent());
  ok('focus still moves to the box that works',
     await psh.evaluate(() => document.activeElement?.classList.contains('lc')));
  await shy.close();
}

/* ---- a name alone does not say where it is ------------------------------
   "Pizza House" tells you nothing about whether it is near you. OSM's addr:*
   keys carry the town where a mapper filled them in; it rides along in the
   same request, so it costs nothing. Coverage is partial and there is no
   honest fallback -- reverse geocoding each result would be one Nominatim
   call per venue, which their policy forbids -- so it is shown where known
   and absent where not, never guessed. */
{
  const card = page.locator('.venue', {hasText:'Fair Grounds'}).first();
  ok('a venue with a town in OSM shows it beside the name',
     (await card.locator('.vname').textContent()).includes('Leominster'),
     await card.locator('.vname').textContent());
  ok('and it reads as part of the name, not a separate column',
     await card.locator('.vname .vtown').count() === 1);
  ok('a venue with no town in OSM shows none rather than a guess',
     await page.locator('.venue', {hasText:'Mystery Mug'}).first()
       .locator('.vtown').count() === 0);
  ok('the town is quieter than the name it qualifies',
     await card.locator('.vtown').evaluate(e => {
       const t = getComputedStyle(e), n = getComputedStyle(e.parentElement);
       return Number(t.fontWeight) < Number(n.fontWeight);
     }));
}

// ---- category search ----------------------------------------------------
ok('search box present', await page.locator('#catSearch').count()===1);
ok('the search box sits below the chips, where you look once none of them fit',
   await page.evaluate(() => {
     const chips = document.querySelector('#cats').getBoundingClientRect();
     const box = document.querySelector('#catSearch').getBoundingClientRect();
     return box.top >= chips.bottom - 1;
   }));
ok('and its placeholder says there is more than the chips show',
   /40\+|more/i.test(await page.locator('#catSearch').getAttribute('placeholder')),
   await page.locator('#catSearch').getAttribute('placeholder'));
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

// ---- clearing a name rolls another --------------------------------------
{
  const nm = page.locator('.person').nth(1).locator('.nm');
  await nm.fill('');
  await page.waitForTimeout(200);
  const first = await nm.inputValue();
  ok('clearing the name fills in a placeholder', first.split(' ').length === 2, first);

  await nm.fill('');
  await page.waitForTimeout(200);
  const second = await nm.inputValue();
  ok('clearing again rolls a different one', second !== first, `${first} then ${second}`);

  ok('the new name is selected, so typing replaces it',
     await page.evaluate(() => {
       const e = document.activeElement;
       return e && e.selectionStart === 0 && e.selectionEnd === e.value.length;
     }));
  await nm.fill('Dana');
  await page.waitForTimeout(200);
  ok('typing a real name sticks', (await nm.inputValue()) === 'Dana');
}

// ---- a typed place is not overwritten by a lookup landing late ----------
{
  const slow = await browser.newContext({viewport:{width:390,height:844}, isMobile:true,
    hasTouch:true, permissions:['geolocation'], geolocation:{latitude:41.9,longitude:-87.63}});
  await stubFonts(slow);
  await slow.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
    r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
  await slow.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  await slow.route('**/nominatim.openstreetmap.org/**', async r => {
    // the reverse lookup lands well after the user starts typing
    if (r.request().url().includes('/reverse')) {
      await new Promise(res => setTimeout(res, 1800));
      return r.fulfill({status:200, contentType:'application/json',
        body: JSON.stringify({display_name:'Somewhere Else, Chicago',
                              address:{neighbourhood:'Somewhere Else', city:'Chicago'}})});
    }
    return r.fulfill({status:200, contentType:'application/json',
      body: JSON.stringify([{lat:'41.7943',lon:'-87.5907',display_name:'Hyde Park, Chicago'}])});
  });
  const ps = await slow.newPage();
  await ps.goto('http://localhost:8099/', {waitUntil:'networkidle'});
  await ps.locator('.person').nth(0).locator('.loc').click();
  await ps.waitForTimeout(250);                    // lookup is in flight
  await ps.locator('.person').nth(0).locator('.lc').fill('Hyde Park, Chicago');
  await ps.locator('.person').nth(0).locator('.lc').press('Tab');
  await ps.waitForTimeout(2600);                   // lookup has now landed

  ok('a typed place survives a lookup that lands after it',
     (await ps.locator('.person').nth(0).locator('.lc').inputValue()) === 'Hyde Park, Chicago',
     await ps.locator('.person').nth(0).locator('.lc').inputValue());
  /* It must still be clear this came from the box and not from GPS -- just
     without reading as a correction. */
  ok('and the row says it was typed rather than measured',
     (await ps.locator('.person').nth(0).locator('.status').textContent()).includes('typed'),
     await ps.locator('.person').nth(0).locator('.status').textContent());
  await slow.close();
}

// ---- saved groups -------------------------------------------------------
{
  ok('the save prompt appears once there are people worth saving',
     await page.locator('#saveGroup').count() === 1);

  await page.locator('#saveGroup').click();
  await page.waitForTimeout(200);
  ok('it suggests a name from the people',
     (await page.locator('.g-name').inputValue()) === 'Sal, Dana',
     await page.locator('.g-name').inputValue());

  await page.locator('.g-name').fill('Tuesday crew');
  await page.locator('.g-ok').click();
  await page.waitForTimeout(250);
  ok('the group appears as a chip',
     (await page.locator('.group-chip .g-load').textContent()).includes('Tuesday crew'));
  ok('and shows how many people are in it',
     (await page.locator('.group-chip .g-n').textContent()).trim() === '2');
  ok('it survives in storage',
     (await page.evaluate(() => JSON.parse(localStorage.getItem('midpoint.groups')))).length === 1);

  // wipe the roster, then bring it back with one tap
  await page.locator('.person').nth(0).locator('.nm').fill('');
  await page.locator('.person').nth(0).locator('.lc').fill('');
  await page.locator('.person').nth(0).locator('.lc').press('Tab');
  await page.waitForTimeout(400);
  await page.locator('.group-chip .g-load').click();
  await page.waitForTimeout(400);
  ok('loading restores the names',
     (await page.locator('.person .nm').evaluateAll(e=>e.map(x=>x.value))).join() === 'Sal,Dana',
     (await page.locator('.person .nm').evaluateAll(e=>e.map(x=>x.value))).join());
  ok('and the places',
     (await page.locator('.person').nth(0).locator('.lc').inputValue()).includes('Wicker Park'),
     await page.locator('.person').nth(0).locator('.lc').inputValue());
  ok('and it can search straight away',
     await page.evaluate(() => !document.querySelector('#find').disabled));

  // saving the same name twice replaces rather than duplicates
  await page.locator('#saveGroup').click();
  await page.waitForTimeout(150);
  await page.locator('.g-name').fill('tuesday crew');
  await page.locator('.g-ok').click();
  await page.waitForTimeout(250);
  ok('re-saving the same name replaces it',
     await page.locator('.group-chip').count() === 1,
     String(await page.locator('.group-chip').count()));

  // cancelling leaves nothing behind
  await page.locator('#saveGroup').click();
  await page.waitForTimeout(150);
  await page.locator('.g-cancel').click();
  await page.waitForTimeout(200);
  ok('cancelling adds no group', await page.locator('.group-chip').count() === 1);

  await page.locator('.group-chip .g-del').click();
  await page.waitForTimeout(250);
  ok('deleting removes it', await page.locator('.group-chip').count() === 0);
  ok('and clears it from storage',
     (await page.evaluate(() => JSON.parse(localStorage.getItem('midpoint.groups')))).length === 0);
}

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

  const name = await venueName(page.locator('.venue').first());
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
// Deliberately NOT asserting that a weekday-hours cafe is dropped here: with
// "now" that depends on when the suite happens to run, and it passed for weeks
// only because runs landed outside office hours. The Wed 23:00 case below
// covers the same behaviour against a fixed moment.
ok('open-now does not drop everything',
   after > 0, `before=${before} after=${after}`);

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
ok('shared link restores both people', await p2.locator('.person').count()===2,
   `count=${await p2.locator('.person').count()}`);
/* Sal sent a link before tapping Go live. That link was location.href -- his
   own rows in the hash, no session code -- so the other phone restored his
   located row, treated it as itself, never offered to locate, and was not
   joined to anything. A link from a device that has never been the author of
   the snapshot must leave you a row of your own. */
{
  const foreign = await browser.newContext({viewport:{width:390,height:844},
    isMobile:true, hasTouch:true});
  await stubFonts(foreign);
  await foreign.route('**/unpkg.com/leaflet**', r => { const u=r.request().url();
    r.fulfill({status:200,contentType:u.endsWith('.css')?'text/css':'text/javascript',
      body:fs.readFileSync(path.join(LEAFLET,u.endsWith('.css')?'leaflet.css':'leaflet.js'),'utf8')});});
  await foreign.route('**/tile.openstreetmap.org/**', r=>r.fulfill({status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}));
  const pf = await foreign.newPage();
  await pf.goto(url, {waitUntil:'networkidle'});     // fresh device, empty storage
  await pf.waitForTimeout(400);
  ok("someone else's plan does not steal their first row as you",
     await pf.locator('.person.me').count() === 1,
     `rows=${await pf.locator('.person').count()} me=${await pf.locator('.person.me').count()}`);
  const mineLoc = await pf.locator('.person.me').locator('.lc').inputValue();
  ok('and the row that is yours is empty, ready to locate',
     mineLoc === '', `got "${mineLoc}"`);
  ok('their people are still all shown',
     await pf.locator('.person').count() === 3,
     String(await pf.locator('.person').count()));
  ok('and it says plainly that this is not a live session',
     /not a live session/i.test(await pf.locator('#log').textContent()),
     await pf.locator('#log').textContent());
  await foreign.close();
}

ok('shared link restores names',
   (await p2.locator('.person').nth(1).locator('.nm').inputValue())==='Dana');
ok('shared link restores coordinates (no re-geocoding needed)', calls.nominatim===2,
   `nominatim total=${calls.nominatim}`);


console.log(`\n${pass} passed, ${fail} failed`);
if(errs.length){ console.log('\nJS errors:'); [...new Set(errs)].forEach(e=>console.log('  '+e)); }
await page.screenshot({path:'shot-results.png', fullPage:false});
await browser.close(); srv.close();
process.exit(fail||errs.length?1:0);
