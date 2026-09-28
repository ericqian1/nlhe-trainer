// Plain-Node test script (no dependencies): `npm test`.
import assert from 'assert';
import fs from 'fs';
import { parseRange, ALL_HANDS, comboCount } from '../js/cards.js';
import { loadRanges, allCharts, PROFILE_ORDER, lookup } from '../js/profiles.js';
import { createHand, advance, applyAction, getContext, POSITIONS } from '../js/engine.js';
import { targetRaise, STACK } from '../js/sizing.js';
import { gradeDecision } from '../js/grade.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n`, e);
    process.exitCode = 1;
  }
}

// Seeded RNG so failures are reproducible.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

loadRanges(fs.readFileSync(new URL('../data/ranges.csv', import.meta.url), 'utf8'));

test('range parser', () => {
  assert.strictEqual(parseRange('22+').size, 13);
  assert.strictEqual(parseRange('A2s+').size, 12);
  const sorted = (str) => [...parseRange(str)].sort();
  assert.deepStrictEqual(sorted('KTs+'), ['KJs', 'KQs', 'KTs']);
  assert.deepStrictEqual(sorted('A5s-A3s'), ['A3s', 'A4s', 'A5s']);
  assert.deepStrictEqual(sorted('99-77'), ['77', '88', '99']);
  assert.deepStrictEqual([...parseRange('AK')], ['AKs', 'AKo']);
  assert.throws(() => parseRange('KAs'));
  assert.strictEqual(ALL_HANDS.length, 169);
  assert.strictEqual(ALL_HANDS.reduce((n, k) => n + comboCount(k), 0), 1326);
});

test('every profile has a chart for every spot kind', () => {
  const charts = allCharts();
  for (const prof of PROFILE_ORDER) {
    for (const pos of POSITIONS) {
      const base = { pos, invested: false, raiserPos: 'UTG' };
      if (pos !== 'BB') lookup(prof, { ...base, kind: 'rfi' });
      if (pos !== 'UTG') lookup(prof, { ...base, kind: 'limped' });
      for (const raiserPos of ['UTG', 'CO']) lookup(prof, { ...base, kind: 'vsOpen', raiserPos });
      for (const kind of ['vs3bet', 'vs4bet', 'vsAllin'])
        for (const invested of [true, false]) lookup(prof, { ...base, kind, invested });
    }
    assert.ok(charts[prof]);
  }
});

test('sizing formulas', () => {
  const base = { maxTo: 200, minRaiseTo: 4 };
  assert.strictEqual(targetRaise({ ...base, level: 1, limpers: 0 }).to, 10);
  assert.strictEqual(targetRaise({ ...base, level: 1, limpers: 3 }).to, 16);
  assert.strictEqual(targetRaise({ ...base, level: 2, callers: 0, lastRaiseTo: 10 }).to, 40);
  assert.strictEqual(targetRaise({ ...base, level: 2, callers: 2, lastRaiseTo: 12 }).to, 72);
  assert.strictEqual(targetRaise({ ...base, level: 3, callers: 0, lastRaiseTo: 40 }).to, 100);
  assert.strictEqual(targetRaise({ ...base, level: 3, callers: 1, lastRaiseTo: 45 }).to, 135);
  assert.strictEqual(targetRaise({ ...base, level: 3, callers: 2, lastRaiseTo: 70 }).to, 200); // capped
  assert.strictEqual(targetRaise({ ...base, level: 4, lastRaiseTo: 100 }).to, 200);
});

test('scripted hand: limp, iso, cold call, 3-bet sizing', () => {
  const table = Array(9).fill('pro');
  // button seat 0 -> UTG is seat 3; hero in seat 0 = BTN.
  const s = createHand({ seatProfiles: table, button: 0, heroSeat: 0, rng: mulberry32(1) });
  assert.strictEqual(s.players[s.heroIdx].pos, 'BTN');
  applyAction(s, 0, 'call'); // UTG limps
  applyAction(s, 1, 'fold');
  applyAction(s, 2, 'fold');
  let ctx = getContext(s, 3);
  assert.strictEqual(ctx.kind, 'limped');
  assert.strictEqual(targetRaise(ctx).to, 12);
  applyAction(s, 3, 'raise', 12); // LJ isos to $12
  applyAction(s, 4, 'call'); // HJ cold calls
  applyAction(s, 5, 'fold');
  ctx = getContext(s, 6);
  assert.strictEqual(ctx.kind, 'vsOpen');
  assert.strictEqual(ctx.callers, 1);
  assert.strictEqual(targetRaise(ctx).to, 60);
  applyAction(s, 6, 'raise', 60);
  applyAction(s, 7, 'fold');
  applyAction(s, 8, 'fold');
  ctx = getContext(s, 0); // UTG limper faces 3-bet cold
  assert.strictEqual(ctx.kind, 'vs3bet');
  assert.strictEqual(ctx.invested, false);
  applyAction(s, 0, 'fold');
  ctx = getContext(s, 3); // LJ iso-raiser faces 3-bet invested
  assert.strictEqual(ctx.invested, true);
  assert.strictEqual(targetRaise(ctx).to, 150);
  assert.strictEqual(s.pot, 1 + 2 + 2 + 12 + 12 + 60);
});

test('20k simulated hands keep chip and turn invariants', () => {
  const rng = mulberry32(42);
  let heroDecisions = 0;
  const kinds = {};
  for (let n = 0; n < 20000; n++) {
    const table = Array.from({ length: 9 }, () => PROFILE_ORDER[Math.floor(rng() * 4)]);
    const s = createHand({ seatProfiles: table, button: n % 9, heroSeat: Math.floor(rng() * 9), rng });
    let ctx = advance(s, rng);
    let guard = 0;
    while (ctx) {
      assert.ok(++guard < 20, 'hero asked to act too many times');
      heroDecisions++;
      kinds[ctx.kind] = (kinds[ctx.kind] || 0) + 1;
      const hero = s.players[s.heroIdx];
      const choices = ['fold', 'call'].concat(ctx.canRaise ? ['raise'] : []);
      const action = choices[Math.floor(rng() * choices.length)];
      const to = action === 'raise' ? targetRaise(ctx).to : undefined;
      const g = gradeDecision(ctx, hero.key, action, to);
      assert.ok(g.proActs.length >= 1);
      if (action === 'raise') assert.strictEqual(g.sizing.grade, 'exact');
      applyAction(s, s.heroIdx, action, to);
      ctx = advance(s, rng);
    }
    assert.ok(s.over && s.result);
    const total = s.players.reduce((a, p) => a + p.committed, 0);
    assert.strictEqual(total, s.pot);
    for (const p of s.players) {
      assert.ok(p.stack >= 0 && p.stack + p.committed === STACK);
    }
    const live = s.players.filter((p) => !p.folded);
    if (live.length > 1) {
      const top = Math.max(...live.map((p) => p.committed));
      for (const p of live) assert.ok(p.allIn || p.committed === top, 'unmatched live player at round end');
    }
  }
  console.log(`  hero decisions by spot: ${JSON.stringify(kinds)} (${heroDecisions} total)`);
});

// Print range widths so the charts can be sanity-checked at a glance.
function pct(chart, actsFilter) {
  let combos = 0;
  for (const [k, acts] of chart.map) if (actsFilter(acts)) combos += comboCount(k);
  return ((combos / 1326) * 100).toFixed(1);
}
const charts = allCharts();
console.log('  RFI raise% (pure / incl. mixed):');
for (const prof of PROFILE_ORDER) {
  for (const [spot, chart] of Object.entries(charts[prof])) {
    if (!spot.startsWith('rfi')) continue;
    console.log(`    ${prof.padEnd(7)} ${spot.padEnd(10)} ${pct(chart, (a) => a.length === 1 && a[0] === 'raise').padStart(5)}% / ${pct(chart, (a) => a.includes('raise')).padStart(5)}%`);
  }
}

console.log(`${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);
