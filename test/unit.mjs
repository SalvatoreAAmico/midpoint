import fs from 'fs';
let src = fs.readFileSync(new URL('../app.js', import.meta.url),'utf8');
// strip the DOM bootstrap so we can exercise the pure functions
src = src.replace(/\n(?:window|document)\.addEventListener\([\s\S]*$/,'');
src += '\nexport {haversine,centroid,isOpenNow,priceLevel,scoreVenues,fmtMin,isChain,shuffle,pickRandom};\n';
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
