import fs from 'fs';
let src = fs.readFileSync(new URL('../app.js', import.meta.url),'utf8');
// strip the DOM bootstrap so we can exercise the pure functions
src = src.replace(/\n(?:window|document)\.addEventListener\([\s\S]*$/,'');
src += '\nexport {haversine,centroid,isOpenNow,priceLevel,scoreVenues,fmtMin,isChain,shuffle,pickRandom,searchCats,tagFilter,CATALOG,CHIP_CATS,findOutliers,SPEED,groupFromPeople,suggestGroupName,codename,TOGETHER_M,TOGETHER_RADIUS,placeName};\n';
fs.writeFileSync(new URL('./.tmp-module.mjs', import.meta.url),src);
const m = await import('./.tmp-module.mjs');

let pass=0,fail=0;
const ok=(n,c)=>{c?(pass++,console.log('  ok  '+n)):(fail++,console.log('  FAIL '+n))};

// distance: Chicago Loop -> O'Hare is ~27 km
const d = m.haversine({lat:41.8781,lon:-87.6298},{lat:41.9742,lon:-87.9073});
ok('haversine Loop->ORD ~27km  got '+(d/1000).toFixed(1)+'km', d>24000 && d<30000);

// centroid of 4 corners around a point returns the point
const c = m.centroid([{lat:41.9,lon:-87.7},{lat:41.7,lon:-87.7},{lat:41.8,lon:-87.8},{lat:41.8,lon:-87.6}]);
ok('centroid ~41.80/-87.70  got '+c.lat.toFixed(3)+'/'+c.lon.toFixed(3),
   Math.abs(c.lat-41.8)<0.01 && Math.abs(c.lon+87.7)<0.01);

// opening hours
const wedNoon = new Date('2026-09-09T12:00:00');  // Wednesday
const wed11pm = new Date('2026-09-09T23:00:00');
const sunNoon = new Date('2026-09-13T12:00:00');  // Sunday
ok('24/7 always open', m.isOpenNow('24/7',wedNoon)===true);
ok('Mo-Fr 08:00-18:00 open Wed noon', m.isOpenNow('Mo-Fr 08:00-18:00',wedNoon)===true);
ok('Mo-Fr 08:00-18:00 closed Wed 11pm', m.isOpenNow('Mo-Fr 08:00-18:00',wed11pm)===false);
ok('Mo-Fr 08:00-18:00 closed Sunday', m.isOpenNow('Mo-Fr 08:00-18:00',sunNoon)===false);
ok('multi-rule Sunday branch', m.isOpenNow('Mo-Sa 09:00-22:00; Su 10:00-16:00',sunNoon)===true);
ok('past-midnight bar open Wed 11pm', m.isOpenNow('Mo-Su 17:00-02:00',wed11pm)===true);
ok('unparseable -> null (never filtered)', m.isOpenNow('by appointment')===null);
ok('missing -> null', m.isOpenNow('')===null);

// price
ok('price $$ -> 2', m.priceLevel({'price:range':'$$'})===2);
ok('price missing -> null', m.priceLevel({})===null);

// fairness: the spread penalty must beat a pure-average win
const people=[{lat:41.90,lon:-87.70},{lat:41.70,lon:-87.70}];
const venues=[
  {key:'a',name:'Lopsided',lat:41.895,lon:-87.70},  // right next to person 1
  {key:'b',name:'Even',    lat:41.80, lon:-87.70}   // dead between them
];
const r = m.scoreVenues(venues,people,null);
ok('fair middle venue outranks lopsided one  (#1 = '+r[0].name+')', r[0].name==='Even');
ok('lopsided venue has larger spread', r.find(x=>x.name==='Lopsided').spread > r.find(x=>x.name==='Even').spread);

// matrix path
const mx=[[600,900],[1200,900]];
const r2=m.scoreVenues(venues,people,mx);
ok('matrix durations are used verbatim', r2[0].costs[0]===900 && r2[0].name==='Even');

// chain detection
ok('brand tag marks a chain', m.isChain({brand:'Starbucks'},'Starbucks')===true);
ok('brand:wikidata marks a chain', m.isChain({'brand:wikidata':'Q37158'},'Coffee Place')===true);
ok('known name marks a chain even with no tags', m.isChain({},'Starbucks Reserve')===true);
ok('Dunkin variants caught', m.isChain({},"Dunkin' Donuts")===true);
ok('independent cafe is not a chain', m.isChain({amenity:'cafe'},'Bow Truss Coffee')===false);
ok('empty name is not a chain', m.isChain({},'')===false);
ok('substring false positive avoided', m.isChain({},'Subversive Records')===false);

// shuffle
const nums=[1,2,3,4,5,6,7,8,9,10];
const sh=m.shuffle(nums);
ok('shuffle preserves every element', sh.slice().sort((a,b)=>a-b).join()===nums.join());
ok('shuffle does not mutate the input', nums.join()==='1,2,3,4,5,6,7,8,9,10');
ok('shuffle actually reorders over 20 runs',
   Array.from({length:20},()=>m.shuffle(nums).join()).some(x=>x!==nums.join()));
{ // every position must be reachable - catches a biased sort-based shuffle
  const seen=new Set();
  for(let i=0;i<300;i++) seen.add(m.shuffle(nums)[0]);
  ok('any element can land first (unbiased)', seen.size===10, `${seen.size}/10 distinct`);
}
ok('pickRandom returns the requested count', m.pickRandom(nums,3).length===3);
ok('pickRandom returns distinct items', new Set(m.pickRandom(nums,5)).size===5);

// category search
const ids = q => m.searchCats(q).map(c=>c.id);
ok('"pizza" finds pizza', ids('pizza')[0]==='pizza', ids('pizza').join());
ok('"beer" resolves to drinks', ids('beer').includes('drinks'), ids('beer').join());
ok('"workout" resolves to active', ids('workout').includes('active'), ids('workout').join());
ok('"tacos" finds mexican', ids('tacos').includes('mexican'), ids('tacos').join());
ok('"books" finds quiet', ids('books').includes('quiet'), ids('books').join());
ok('"kids" finds playground', ids('kids').includes('playground'), ids('kids').join());
// the long tail must resolve UPWARD, never to nothing
ok('"axe throwing" finds games', ids('axe throwing')[0]==='games', ids('axe throwing').join());
ok('"escape room" finds games', ids('escape room')[0]==='games', ids('escape room').join());
ok('"laser tag" finds games', ids('laser tag')[0]==='games', ids('laser tag').join());
ok('"level 99" finds games', ids('level 99')[0]==='games', ids('level 99').join());
ok('"bowling" finds games', ids('bowling')[0]==='games', ids('bowling').join());
ok('"things to do" finds games', ids('things to do')[0]==='games', ids('things to do').join());
ok('"arcade" still resolves after folding it in', ids('arcade')[0]==='games', ids('arcade').join());
ok('"karaoke" still resolves to drinks', ids('karaoke').includes('drinks'), ids('karaoke').join());
ok('"gym" still finds active', ids('gym')[0]==='active', ids('gym').join());
ok('games casts a wide net including a sport=* match',
   m.CATALOG.find(c=>c.id==='games').tags.some(t=>t.startsWith('sport~')),
   m.CATALOG.find(c=>c.id==='games').tags.join(' | '));
ok('the sport=* match compiles to a loose filter',
   m.tagFilter('sport~laser_tag|paintball') === '["sport"~"laser_tag|paintball",i]',
   m.tagFilter('sport~laser_tag|paintball'));
// multi-word narrows rather than widens
ok('"mini golf" finds games', ids('mini golf')[0]==='games', ids('mini golf').join());
/* ---- meals ---------------------------------------------------------------
   "Food" already carried lunch and dinner as synonyms, so the risk is the new
   entries losing to it: typing "dinner" must offer Dinner first, not Food. */
/* Sal searched Breakfast and got "Romano's Pizza Pasta", tagged amenity=cafe.
   OSM's cafe bucket holds anything counter-ish, pizzerias included. */
{
  ok('a negated regex filter compiles',
     m.tagFilter('cuisine!~pizza') === '["cuisine"!~"pizza",i]', m.tagFilter('cuisine!~pizza'));
  ok('a negated equality filter compiles',
     m.tagFilter('brand!=Starbucks') === '["brand"!="Starbucks"]', m.tagFilter('brand!=Starbucks'));
  ok('negation composes with a positive term',
     m.tagFilter('amenity=cafe&cuisine!~pizza') === '["amenity"="cafe"]["cuisine"!~"pizza",i]',
     m.tagFilter('amenity=cafe&cuisine!~pizza'));
  ok('plain filters are unchanged by the new parser',
     m.tagFilter('amenity=cafe') === '["amenity"="cafe"]' &&
     m.tagFilter('sport~laser_tag|paintball') === '["sport"~"laser_tag|paintball",i]');

  const bf = m.CATALOG.find(c => c.id === 'breakfast');
  const cafeRule = bf.tags.find(t => t.startsWith('amenity=cafe'));
  ok('breakfast still reaches cafes', !!cafeRule, bf.tags.join(' | '));
  ok('but excludes the plainly-dinner cuisines',
     /cuisine!~/.test(cafeRule) && /pizza/.test(cafeRule), cafeRule);
  ok('and the exclusion compiles to a real Overpass filter',
     m.tagFilter(cafeRule).includes('["cuisine"!~'), m.tagFilter(cafeRule));
  /* A cuisine exclusion only bites where a cuisine was tagged, and Romano's
     may carry none -- hence the name guard as well. */
  ok('a name guard catches the ones with no cuisine tag',
     /name!~/.test(cafeRule) && m.tagFilter(cafeRule).includes('["name"!~'),
     m.tagFilter(cafeRule));
  ok('the name guard stays short, since each word is a place it may drop',
     (cafeRule.match(/name!~([^&]*)/)?.[1].split('|').length || 99) <= 6,
     cafeRule.match(/name!~([^&]*)/)?.[1]);
  ok('no other category filters on name, which is a last resort',
     m.CATALOG.filter(c => c.tags?.some(t => t.includes('name!~'))).length === 1,
     m.CATALOG.filter(c => c.tags?.some(t => t.includes('name!~'))).map(c=>c.id).join());
}

ok('typing breakfast offers Breakfast first', ids('breakfast')[0] === 'breakfast', ids('breakfast').join());
ok('typing lunch offers Lunch first',         ids('lunch')[0]     === 'lunch',     ids('lunch').join());
ok('typing dinner offers Dinner first',       ids('dinner')[0]    === 'dinner',    ids('dinner').join());
ok('brunch still finds breakfast', ids('brunch').includes('breakfast'), ids('brunch').join());
ok('supper finds dinner',          ids('supper').includes('dinner'),    ids('supper').join());

{
  const meal = id => m.CATALOG.find(c => c.id === id);
  ok('each meal carries a time', ['breakfast','lunch','dinner'].every(id => /^\d\d:\d\d$/.test(meal(id).meal || '')),
     ['breakfast','lunch','dinner'].map(id => id + '=' + meal(id).meal).join(' '));
  ok('the times are in the right order',
     meal('breakfast').meal < meal('lunch').meal && meal('lunch').meal < meal('dinner').meal);

  /* Tags alone cannot tell lunch from dinner -- that is what the mealtime is
     for -- but they should not be identical either, or the categories are
     three names for one search. */
  const t = id => meal(id).tags.join('|');
  ok('the three meals do not share one tag set',
     new Set(['breakfast','lunch','dinner'].map(t)).size === 3);
  ok('breakfast reaches cafes and bakeries',
     t('breakfast').includes('amenity=cafe') && t('breakfast').includes('shop=bakery'));
  ok('lunch reaches delis and counters',
     t('lunch').includes('shop=deli') && t('lunch').includes('amenity=fast_food'));
  ok('dinner is sit-down, not fast food',
     t('dinner').includes('amenity=restaurant') && !t('dinner').includes('fast_food'));
  ok('every meal tag compiles to a real Overpass filter',
     ['breakfast','lunch','dinner'].every(id =>
       meal(id).tags.every(tag => m.tagFilter(tag).startsWith('['))),
     ['breakfast','lunch','dinner'].flatMap(id => meal(id).tags.map(m.tagFilter)).join(' '));
}

ok('empty query returns nothing', m.searchCats('   ').length===0);
ok('gibberish returns nothing', m.searchCats('zzzqqq').length===0);
ok('results are capped at 8', m.searchCats('a').length<=8, String(m.searchCats('a').length));

// every headline chip must be a real catalogue entry
ok('all chip ids exist in the catalogue',
   m.CHIP_CATS.every(id => m.CATALOG.some(c=>c.id===id)));
ok('there are exactly 8 headline chips', m.CHIP_CATS.length===8, String(m.CHIP_CATS.length));
ok('catalogue ids are unique',
   new Set(m.CATALOG.map(c=>c.id)).size === m.CATALOG.length);
ok('every category has tags and synonyms',
   m.CATALOG.every(c => c.tags?.length && c.syn?.length));

// overpass tag compilation
ok('simple tag compiles', m.tagFilter('amenity=cafe')==='["amenity"="cafe"]', m.tagFilter('amenity=cafe'));
ok('ANDed cuisine tag compiles',
   m.tagFilter('amenity=restaurant&cuisine~pizza')==='["amenity"="restaurant"]["cuisine"~"pizza",i]',
   m.tagFilter('amenity=restaurant&cuisine~pizza'));
ok('every catalogue tag compiles to a filter',
   m.CATALOG.every(c => c.tags.every(t => m.tagFilter(t).startsWith('['))));

// ---- the outlier problem -------------------------------------------------
{
  const cluster = [
    {lat:41.878,lon:-87.630},{lat:41.895,lon:-87.650},{lat:41.860,lon:-87.615},
    {lat:41.885,lon:-87.660},{lat:41.870,lon:-87.640},{lat:41.900,lon:-87.625},
    {lat:41.865,lon:-87.655}
  ];
  const far = {lat:42.500,lon:-88.500, name:'Mike'};
  const all = [...cluster, far];
  const c = m.centroid(cluster);
  const venues = [0,0.1,0.25,0.5,0.75,1].map(t => ({
    key:'v'+t, name:(t*100)+'%',
    lat:c.lat+(far.lat-c.lat)*t, lon:c.lon+(far.lon-c.lon)*t }));

  ok('a genuinely distant person is detected',
     m.findOutliers(all).length===1 && m.findOutliers(all)[0].name==='Mike');
  ok('a normally spread group flags nobody', m.findOutliers(cluster).length===0);
  ok('fewer than three people never flags anyone',
     m.findOutliers([cluster[0], far]).length===0);

  const equal = m.scoreVenues(venues, all, null);
  ok('equal mode still drags the group out (the honest trade-off)',
     equal[0].name === '50%', equal[0].name);

  const flexed = m.scoreVenues(venues, [...cluster, {...far, flex:true}], null);
  ok('marking the far person flexible keeps the meetup in town',
     flexed[0].name === '0%', flexed[0].name);

  const localsAvg = r => r[0].costs.slice(0,7).reduce((a,b)=>a+b,0)/7/60;
  const saved = localsAvg(equal) - localsAvg(flexed);
  ok(`each of the 7 saves ~${saved.toFixed(0)} min when he volunteers`, saved > 45,
     saved.toFixed(0));
  ok('a flagged person is no longer flagged once flexible',
     m.findOutliers([...cluster, {...far, flex:true}]).length===0);
  ok('the far person still gets a real travel time shown',
     flexed[0].costs[7] > 0 && Number.isFinite(flexed[0].costs[7]));

  // flexibility must not wreck an evenly spread group
  const evenFlex = m.scoreVenues(venues, cluster.map((p,i)=>({...p, flex:i===0})), null);
  ok('one volunteer in an even group does not distort the pick',
     evenFlex[0].name === '0%', evenFlex[0].name);
}

// ---- volunteering has to work for a pair, the commonest group ------------
{
  const A={lat:42.52,lon:-71.76}, B={lat:42.55,lon:-71.90};
  const v=[{key:'1',name:'Near B',lat:42.552,lon:-71.898},
           {key:'2',name:'Near A',lat:42.522,lon:-71.762}];
  const top = ps => m.scoreVenues(v, ps, null, m.SPEED.drive)[0].name;
  ok('a balanced pair gets a balanced answer', top([A,B])==='Near A', top([A,B]));
  ok('A volunteering moves the answer toward B',
     top([{...A,flex:true},B])==='Near B', top([{...A,flex:true},B]));
  ok('B volunteering keeps it near A',
     top([A,{...B,flex:true}])==='Near A', top([A,{...B,flex:true}]));
  const spread = ps => m.scoreVenues(v, ps, null, m.SPEED.drive)[0].spread;
  ok('one volunteer in a pair leaves no fairness spread to balance',
     spread([{...A,flex:true},B]) === 0, String(spread([{...A,flex:true},B])));
  ok('but a pair with nobody volunteering still has one',
     spread([A,B]) > 0);
  ok('everyone volunteering falls back to plain averages',
     spread([{...A,flex:true},{...B,flex:true}]) > 0);
}

// ---- walking vs driving --------------------------------------------------
{
  const people=[{lat:41.880,lon:-87.630},{lat:41.890,lon:-87.640}];
  const v=[{key:'a',name:'A',lat:41.885,lon:-87.635}];
  const drive = m.scoreVenues(v, people, null, m.SPEED.drive);
  const walk  = m.scoreVenues(v, people, null, m.SPEED.walk);
  ok('walking takes longer than driving over the same distance',
     walk[0].mean > drive[0].mean * 5, `${drive[0].mean.toFixed(0)}s vs ${walk[0].mean.toFixed(0)}s`);
  ok('walking speed is a believable pace (3-6 km/h)',
     m.SPEED.walk*3.6 > 3 && m.SPEED.walk*3.6 < 6, (m.SPEED.walk*3.6).toFixed(1)+' km/h');
}

// ---- saved groups --------------------------------------------------------
{
  const people=[
    {id:'a',name:'Sal',label:'Wicker Park',lat:41.9,lon:-87.68,flex:false,status:'x'},
    {id:'b',name:'Ravi',label:'Hyde Park',lat:41.79,lon:-87.59,flex:true,status:'y'},
    {id:'c',name:'',label:'',lat:null,lon:null,flex:false,status:''}
  ];
  const g=m.groupFromPeople('Tuesday crew', people);
  ok('a group keeps only people worth restoring', g.people.length===2, String(g.people.length));
  ok('it keeps names, places and coordinates',
     g.people[0].name==='Sal' && g.people[0].label==='Wicker Park' && g.people[0].lat===41.9);
  ok('it keeps who volunteered to travel', g.people[1].flex===true);
  ok('it drops transient status', !('status' in g.people[0]));
  ok('it drops ids, so a group can be loaded twice', !('id' in g.people[0]));
  ok('the group itself gets an id', !!g.id);
  ok('long names are trimmed',
     m.groupFromPeople('x'.repeat(80), people).name.length===40);

  ok('a suggested name lists the people', m.suggestGroupName(people)==='Sal, Ravi',
     m.suggestGroupName(people));
  const many=[{name:'A'},{name:'B'},{name:'C'},{name:'D'}];
  ok('and summarises when there are many', m.suggestGroupName(many)==='A, B +2',
     m.suggestGroupName(many));
  ok('no names gives no suggestion', m.suggestGroupName([{name:''},{name:'  '}])==='');
  ok('a group of unnamed people with locations still saves',
     m.groupFromPeople('x',[{name:'',lat:1,lon:2}]).people.length===1);
}

// ---- codenames -----------------------------------------------------------
{
  ok('a codename is two words', m.codename('abc123').split(' ').length===2, m.codename('abc123'));
  ok('the same id always gives the same name', m.codename('xyz')===m.codename('xyz'));
  ok('different ids usually differ', m.codename('aaa')!==m.codename('bbb'));
  const seen=new Set();
  for(let i=0;i<2000;i++) seen.add(m.codename('id'+i));
  ok(`2000 ids spread across ${seen.size} names`, seen.size>800, String(seen.size));
  // eight people in one session should not collide in practice
  let clashes=0;
  for(let t=0;t<400;t++){
    const names=new Set();
    for(let i=0;i<8;i++) names.add(m.codename(Math.random().toString(36).slice(2,8)));
    if(names.size<8) clashes++;
  }
  ok(`clashes in a group of 8: ${clashes}/400 trials`, clashes<20, String(clashes));
}

// ---- everyone in one place ------------------------------------------------
{
  const here=[{lat:41.90000,lon:-87.67000},{lat:41.90003,lon:-87.67002}];
  const c=m.centroid(here);
  const maxFrom=Math.max(...here.map(p=>m.haversine(p,c)));
  ok('two phones in one house count as together', maxFrom < m.TOGETHER_M, maxFrom.toFixed(1)+'m');
  ok('and the search widens rather than using the usual floor',
     m.TOGETHER_RADIUS.drive > 1500 && m.TOGETHER_RADIUS.walk > 600);
  const far=[{lat:41.90,lon:-87.67},{lat:41.86,lon:-87.62}];
  const c2=m.centroid(far);
  ok('a normally spread pair is not "together"',
     Math.max(...far.map(p=>m.haversine(p,c2))) > m.TOGETHER_M);
  // ranking still behaves when everyone is at one point
  const v=[{key:'a',name:'Near',lat:41.9010,lon:-87.6710},{key:'b',name:'Far',lat:41.9120,lon:-87.6810}];
  const r=m.scoreVenues(v,here,null,m.SPEED.drive);
  ok('nearest wins when nobody has further to travel', r[0].name==='Near', r[0].name);
  ok('and the spread is effectively nil', r[0].spread < 1, String(r[0].spread));
}

// ---- place names read the same however they were found -------------------
{
  ok('a neighbourhood names its city',
     m.placeName({neighbourhood:'Wicker Park', city:'Chicago', state:'Illinois'})==='Wicker Park, Chicago',
     m.placeName({neighbourhood:'Wicker Park', city:'Chicago', state:'Illinois'}));
  ok('a whole town falls through to its state, not itself',
     m.placeName({city:'Leominster', county:'Worcester County', state:'Massachusetts'})==='Leominster, Massachusetts',
     m.placeName({city:'Leominster', county:'Worcester County', state:'Massachusetts'}));
  ok('county is never used — nobody says Worcester County',
     !m.placeName({town:'Gardner', county:'Worcester County', state:'Massachusetts'}).includes('County'),
     m.placeName({town:'Gardner', county:'Worcester County', state:'Massachusetts'}));
  ok('a village names its town', m.placeName({village:'Stow', state:'Massachusetts'})==='Stow, Massachusetts');
  ok('no address details falls back to the display name',
     m.placeName({}, 'Somewhere, Someplace, Somecountry')==='Somewhere, Someplace');
  ok('nothing at all returns nothing', m.placeName({}, '')==='');
}

/* ---- the palette ---------------------------------------------------------
   Light mode is two blocks restating the same tokens. That only works while
   no rule carries a colour of its own, and while the two blocks agree. Both
   are invisible to the eye in the theme you happen to be looking at, so they
   are checked here instead. */
{
  const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const nc = css.replace(/\/\*[\s\S]*?\*\//g, '');          // no comments

  /* A palette block is any rule selecting :root. Strip them all, then nothing
     coloured may remain. */
  const paletteRe = /:root[^{]*\{([^}]*)\}/g;
  const palettes = [...nc.matchAll(paletteRe)];
  const stripped = nc.replace(paletteRe, '').replace(/#[A-Za-z][\w-]*/g, '');

  const raw = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  ok('no rule outside a :root palette carries a raw hex colour', raw.length === 0, raw.join(' '));
  const rgba = (stripped.match(/rgba?\([^)]*\)/g) || [])
                 .filter(v => !/^rgba?\(0,\s*0,\s*0/.test(v));
  ok('no rule outside a :root palette carries a raw rgb colour', rgba.length === 0, rgba.join(' '));

  ok('there are three palette blocks: dark, light-by-phone, light-by-choice',
     palettes.length === 3, String(palettes.length));

  const decls = t => t.split(';').map(x => x.trim()).filter(Boolean).sort().join(';');
  const [dark, byPhone, byChoice] = palettes.map(m => decls(m[1]));
  ok('the two light blocks are identical, so neither can drift',
     byPhone === byChoice);

  const names = t => new Set(t.split(';').map(d => d.split(':')[0].trim()).filter(n => n.startsWith('--')));
  const dn = names(dark), ln = names(byPhone);
  const missing = [...dn].filter(n => !ln.has(n) && n !== '--r' && n !== '--safe-b');
  ok('light restates every colour token dark defines', missing.length === 0, missing.join(' '));

  /* Contrast. The brief was "easy on eyes"; this is the only part of that
     which can be measured rather than argued about. */
  const val = (block, name) => {
    const m = block.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'));
    return m ? m[1].trim() : null;
  };
  const lum = h => {
    const n = h.replace('#','');
    const p = [0,2,4].map(i => parseInt(n.slice(i,i+2),16)/255)
      .map(c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
    return 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2];
  };
  const ratio = (a,b) => { const x=lum(a), y=lum(b), hi=Math.max(x,y), lo=Math.min(x,y);
                           return (hi+0.05)/(lo+0.05); };

  /* An input has to look like an input before anyone can read what is in it.
     Neither the fill nor the border alone carries that -- a faint box with a
     faint outline is still invisible -- so require one of them to separate
     from the sheet by a visible margin. */
  for (const [label, block] of [['dark', dark], ['light', byPhone]]) {
    const c = n => val(block, n);
    const sep = Math.max(ratio(c('--field'), c('--panel')), ratio(c('--line'), c('--panel')));
    ok(`${label}: a text field is distinguishable from the sheet behind it`,
       sep >= 1.4, `best of fill/border = ${sep.toFixed(2)}, need 1.40`);
  }

  for (const [label, block] of [['dark', dark], ['light', byPhone]]) {
    const c = n => val(block, n);
    const checks = [
      ['body text on the sheet',        c('--ink'),        c('--panel'), 4.5],
      ['body text on the page',         c('--ink'),        c('--bg'),    4.5],
      ['text you type into a field',    c('--ink'),        c('--field'), 4.5],
      ['secondary text',                c('--muted'),      c('--panel'), 4.5],
      ['faint text',                    c('--dim'),        c('--panel'), 3.0],
      ['label on the primary button',   c('--accent-ink'), c('--accent'),4.5],
      ['accent text on the sheet',      c('--accent'),     c('--panel'), 4.5],
      ['accent text in a pill',         c('--accent'),     c('--field'), 4.5],
      ['warning text in a pill',        c('--warn'),       c('--field'), 4.5],
      ['error text on the sheet',       c('--bad'),        c('--panel'), 4.5],
      /* A placeholder is the only thing in an empty input. At 2.77:1 the
         category search read as blank space on a bright screen and Sal could
         not find it at all -- twice, while I insisted from a headless browser
         that it was there. Placeholders are text and are held to text rules. */
      ['placeholder text in a field',   c('--muted'),      c('--field'), 4.5],
    ];
    for (const [what, fg, bg, need] of checks) {
      const r = fg && bg ? ratio(fg, bg) : 0;
      ok(`${label}: ${what} is legible`, r >= need,
         `${fg} on ${bg} = ${r.toFixed(2)}, need ${need}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
