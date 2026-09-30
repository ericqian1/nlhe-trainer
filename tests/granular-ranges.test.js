import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadRanges, lookup, allCharts } from '../js/profiles.js';
import { ALL_HANDS } from '../js/cards.js';
import { createHand, applyAction, getContext } from '../js/engine.js';
loadRanges(fs.readFileSync(new URL('../data/ranges.csv', import.meta.url), 'utf8'));
const exact = Object.keys(allCharts().pro).filter(s => s.split('.').length === 3);
assert.equal(exact.length, 72);
for (const spot of exact) {
  const [kind,pos,raiserPos]=spot.split('.');
  const ctx={kind:kind==='vsLimpRaise'?'vsOpen':kind,pos,raiserPos,limpers:0,callers:0,wasOpener:true,invested:true,cleanHeadsUp:true};
  if(kind==='vsLimpRaise'){ctx.selfLimped=true;ctx.limpers=1;ctx.wasOpener=false;}
  assert.equal(lookup('pro',ctx).spot,spot);
  assert.equal(new Set([...allCharts().pro[spot].map.keys()]).size,allCharts().pro[spot].map.size);
}
assert.equal(lookup('pro',{kind:'vsOpen',pos:'BTN',raiserPos:'CO',limpers:0,callers:1}).spot,'vsOpen.IP_late');
assert.equal(lookup('pro',{kind:'vsOpen',pos:'BTN',raiserPos:'CO',limpers:1,callers:0}).spot,'vsOpen.IP_late');
assert.equal(lookup('pro',{kind:'vs3bet',pos:'UTG',raiserPos:'CO',invested:true,wasOpener:false,cleanHeadsUp:true,limpers:0}).spot,'vs3bet.invested');
assert.equal(lookup('pro',{kind:'vs3bet',pos:'UTG',raiserPos:'CO',invested:true,wasOpener:true,cleanHeadsUp:false,limpers:0}).spot,'vs3bet.invested');
assert.ok(!exact.some(s=>s.endsWith('.LJ+2')));
// Exercise actual engine context: original opener vs a 3-bettor.
const rng=()=>0.5;
let s=createHand({seatProfiles:Array(9).fill('pro'),button:0,heroSeat:3,rng});
applyAction(s,0,'raise',10);
applyAction(s,5,'raise',40);
let ctx=getContext(s,0);
assert.equal(ctx.wasOpener,true);assert.equal(ctx.cleanHeadsUp,true);
assert.equal(lookup('pro',ctx).spot,'vs3bet.UTG.CO');
// A cold caller is invested but must not get an original opener's chart.
s=createHand({seatProfiles:Array(9).fill('pro'),button:0,heroSeat:3,rng});
applyAction(s,0,'raise',10);applyAction(s,1,'call');applyAction(s,5,'raise',40);
ctx=getContext(s,1);assert.equal(ctx.wasOpener,false);
assert.equal(getContext(s,0).cleanHeadsUp,false);
assert.equal(lookup('pro',ctx).spot,'vs3bet.invested');
// SB completes and BB raises: use the limp-response chart rather than the open-response chart.
s=createHand({seatProfiles:Array(9).fill('pro'),button:0,heroSeat:3,rng});
for(let i=0;i<7;i++)applyAction(s,i,'fold');
applyAction(s,7,'call');applyAction(s,8,'raise',10);
ctx=getContext(s,7);assert.equal(ctx.selfLimped,true);
assert.equal(lookup('pro',ctx).spot,'vsLimpRaise.SB.BB');
console.log(`PASS: ${exact.length} exact position-pair charts; engine and fallback routing.`);
