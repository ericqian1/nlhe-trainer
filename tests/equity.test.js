// Plain-Node tests for the hand evaluator and equity enumeration: `npm test`.
import assert from 'assert';
import { evaluate, cardId, calcEquity, handName } from '../js/equity.js';
import { combosOf, newDeck, shuffle } from '../js/cards.js';

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

const score = (str) => {
  const ids = str.split(' ').map(cardId);
  return evaluate(ids, ids.length);
};

test('combosOf', () => {
  assert.strictEqual(combosOf('AA').length, 6);
  assert.strictEqual(combosOf('AKs').length, 4);
  assert.strictEqual(combosOf('A6o').length, 12);
  assert.ok(combosOf('AKs').every(([a, b]) => a[1] === b[1]));
  assert.ok(combosOf('A6o').every(([a, b]) => a[1] !== b[1]));
});

test('hand categories', () => {
  const cases = {
    'As Ks Qs Js Ts 2d 3c': 'Straight flush',
    'Ah 2h 3h 4h 5h Kd Kc': 'Straight flush',
    '9c 9d 9h 9s 2c 3d 4h': 'Four of a kind',
    '9c 9d 9h 2s 2c 3d 4h': 'Full house',
    '9c 9d 9h 2s 2c 2d 4h': 'Full house',
    'Ac 7c 5c 3c 2c Kd Kh': 'Flush',
    'Ad 2c 3h 4s 5d Kd Kh': 'Straight',
    '9c 9d 9h 2s 5c Jd 4h': 'Three of a kind',
    '9c 9d 2h 2s 5c Jd 4h': 'Two pair',
    '9c 9d 3h 2s 5c 6d 4h': 'Straight',
    '9c 9d 3h 2s Qc Jd 7h': 'Pair',
    'Ac Jd 3h 2s Qc 8d 7h': 'High card',
  };
  for (const [cards, name] of Object.entries(cases)) assert.strictEqual(handName(cards.split(' ')), name, cards);
});

test('ordering and kickers', () => {
  assert.ok(score('As Ad Kc Qd 2h 3s 7c') > score('As Ad Kc Jd 2h 3s 7c'), 'pair kicker');
  assert.ok(score('Ah 2c 3d 4s 5h') < score('2c 3d 4s 5h 6h'), 'wheel is lowest straight');
  assert.ok(score('Kc Kd 5h 5s 2c 2d Ah') > score('Kc Kd 5h 5s 3c 3d Qh'), 'two pair uses best kicker incl. third pair');
  assert.strictEqual(score('Kc Kd 5h 5s 2c 2d Ah'), score('Kc Kd 5h 5s Ah 7d 3h'), 'third pair ignored beyond kicker');
  assert.ok(score('Tc Td Th 4s 4c Ad Kh') > score('9c 9d 9h As Ac Kd Qh'), 'full house by trips rank');
});

test('7-card score equals best 5-card subset (5k random hands)', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 5000; n++) {
    const ids = shuffle(newDeck(), rng).slice(0, 7).map(cardId);
    let best = -1;
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
      const five = ids.filter((_, i) => i !== a && i !== b);
      best = Math.max(best, evaluate(five, 5));
    }
    assert.strictEqual(evaluate(ids, 7), best);
  }
});

test('exact equity vs hand-counted outs', () => {
  // Villain KK needs one of 2 kings in 44 river cards.
  let r = calcEquity({ hero: ['Ac', 'Ad'], board: ['2s', '7d', '9h', 'Tc'], villain: [['Kc', 'Kd']] });
  assert.ok(Math.abs(r.equity - 42 / 44) < 1e-9);
  // Flop: villain wins on 87 runouts with a king, minus 4 where an ace also comes (AAA beats KKK).
  r = calcEquity({ hero: ['Ac', 'Ad'], board: ['2s', '7d', '9h'], villain: [['Kc', 'Kd']] });
  assert.ok(Math.abs(r.equity - 907 / 990) < 1e-9);
  assert.strictEqual(r.runouts, 990);
  // Same hand chopping the board.
  r = calcEquity({ hero: ['2c', '3d'], board: ['As', 'Ks', 'Qs', 'Js', 'Ts'], villain: [['4c', '5d']] });
  assert.strictEqual(r.tie, 1, JSON.stringify(r));
  // Blocked combos are dropped.
  r = calcEquity({ hero: ['Ac', 'Ad'], board: ['Ks', '7d', '2h'], villain: combosOf('AA').concat(combosOf('KK')) });
  assert.strictEqual(r.combos, 1 + 3);
});

test('full-range flop enumeration runs in reasonable time', () => {
  const villain = [];
  const all = newDeck();
  for (let i = 0; i < 52; i++) for (let j = i + 1; j < 52; j++) villain.push([all[i], all[j]]);
  const t = Date.now();
  const r = calcEquity({ hero: ['Ah', 'Kh'], board: ['Qh', '7h', '2c'], villain });
  const ms = Date.now() - t;
  console.log(`  AhKh on Qh7h2c vs any two: ${(r.equity * 100).toFixed(2)}% over ${r.combos} combos in ${ms} ms`);
  assert.ok(r.combos === 1081);
});

console.log(`${passed} equity tests passed${process.exitCode ? ', some FAILED' : ''}`);
