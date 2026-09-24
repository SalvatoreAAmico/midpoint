import fs from 'fs';
let src = fs.readFileSync(new URL('../app.js', import.meta.url),'utf8');
// strip the DOM bootstrap so we can exercise the pure functions
src = src.replace(/\n(?:window|document)\.addEventListener\([\s\S]*$/,'');
src += '\nexport {haversine,centroid,isOpenNow,priceLevel,scoreVenues,fmtMin,isChain,shuffle,pickRandom,searchCats,tagFilter,CATALOG,CHIP_CATS,findOutliers,SPEED};\n';
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
