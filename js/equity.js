// Hand evaluation and exact postflop equity enumeration.
// Cards are strings like 'As' at the edges; internally ids 0-51 = rank*4 + suit,
// with rank 0 = deuce ... 12 = ace.

import { handKey } from './cards.js';

const RANK_VAL = {};
'23456789TJQKA'.split('').forEach((r, i) => (RANK_VAL[r] = i));
const SUIT_VAL = { s: 0, h: 1, d: 2, c: 3 };

export const cardId = (c) => RANK_VAL[c[0]] * 4 + SUIT_VAL[c[1]];

export const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

// STRAIGHT_HIGH[rankMask] = rank of the straight's top card, or -1.
const STRAIGHT_HIGH = new Int8Array(8192).fill(-1);
for (let m = 0; m < 8192; m++) {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0x1f << (hi - 4);
    if ((m & need) === need) {
      STRAIGHT_HIGH[m] = hi;
      break;
    }
  }
  if (STRAIGHT_HIGH[m] < 0 && (m & 0x100f) === 0x100f) STRAIGHT_HIGH[m] = 3; // wheel A-5
}

function topBits(mask, n) {
  let v = 0;
  for (let r = 12; r >= 0 && n > 0; r--) {
    if (mask & (1 << r)) {
      v = (v << 4) | r;
      n--;
    }
  }
  return v;
}

const rc = new Int8Array(13);
const sc = new Int8Array(4);
const sm = new Int32Array(4);

// Score 5-7 cards (ids). Higher is better; category is score >> 20.
export function evaluate(cards, n) {
  rc.fill(0);
  sc.fill(0);
  sm.fill(0);
  let rm = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    rc[r]++;
    sc[s]++;
    sm[s] |= 1 << r;
    rm |= 1 << r;
  }
  // With at most 7 cards, a flush rules out quads and full houses.
  for (let s = 0; s < 4; s++) {
    if (sc[s] >= 5) {
      const st = STRAIGHT_HIGH[sm[s]];
      return st >= 0 ? (8 << 20) | st : (5 << 20) | topBits(sm[s], 5);
    }
  }
  let quad = -1;
  let trips = -1;
  let trips2 = -1;
  let p1 = -1;
  let p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = rc[r];
    if (k === 4) quad = r;
    else if (k === 3) {
      if (trips < 0) trips = r;
      else if (trips2 < 0) trips2 = r;
    } else if (k === 2) {
      if (p1 < 0) p1 = r;
      else if (p2 < 0) p2 = r;
    }
  }
  if (quad >= 0) return (7 << 20) | (quad << 4) | topBits(rm & ~(1 << quad), 1);
  if (trips >= 0 && (p1 >= 0 || trips2 >= 0)) return (6 << 20) | (trips << 4) | Math.max(p1, trips2);
  const st = STRAIGHT_HIGH[rm];
  if (st >= 0) return (4 << 20) | st;
  if (trips >= 0) return (3 << 20) | (trips << 8) | topBits(rm & ~(1 << trips), 2);
  if (p2 >= 0) return (2 << 20) | (p1 << 8) | (p2 << 4) | topBits(rm & ~(1 << p1) & ~(1 << p2), 1);
  if (p1 >= 0) return (1 << 20) | (p1 << 12) | topBits(rm & ~(1 << p1), 3);
  return topBits(rm, 5);
}

export function handName(cardStrs) {
  const ids = cardStrs.map(cardId);
  return HAND_NAMES[evaluate(ids, ids.length) >> 20];
}

// Exact equity of hero vs. each villain combo, enumerating every runout.
// job = { hero: ['As','Kd'], board: [3-5 cards], villain: [['Qh','Qd'], ...] }
export function calcEquity(job, onProgress) {
  const heroIds = job.hero.map(cardId);
  const boardIds = job.board.map(cardId);
  const dead = new Uint8Array(52);
  for (const c of heroIds.concat(boardIds)) dead[c] = 1;

  const combos = [];
  for (const [a, b] of job.villain) {
    const ia = cardId(a);
    const ib = cardId(b);
    if (!dead[ia] && !dead[ib] && ia !== ib) combos.push([ia, ib, handKey(a, b)]);
  }

  const need = 5 - boardIds.length;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);

  // Hero's score only depends on the runout, so compute it once per runout.
  const hc = new Int32Array(7);
  hc[0] = heroIds[0];
  hc[1] = heroIds[1];
  boardIds.forEach((c, i) => (hc[2 + i] = c));
  const heroScore = new Int32Array(52 * 52);
  if (need === 0) heroScore[0] = evaluate(hc, 7);
  else if (need === 1) {
    for (const x of deck) {
      hc[6] = x;
      heroScore[x] = evaluate(hc, 7);
    }
  } else {
    for (let i = 0; i < deck.length; i++) {
      hc[5] = deck[i];
      for (let j = i + 1; j < deck.length; j++) {
        hc[6] = deck[j];
        heroScore[deck[i] * 52 + deck[j]] = evaluate(hc, 7);
      }
    }
  }

  const vc = new Int32Array(7);
  boardIds.forEach((c, i) => (vc[2 + i] = c));
  let win = 0;
  let tie = 0;
  let total = 0;
  const perClass = {};

  for (let k = 0; k < combos.length; k++) {
    const [va, vb, key] = combos[k];
    vc[0] = va;
    vc[1] = vb;
    let w = 0;
    let t = 0;
    let n = 0;
    const cmp = (hs) => {
      const vs = evaluate(vc, 7);
      if (hs > vs) w++;
      else if (hs === vs) t++;
      n++;
    };
    if (need === 0) cmp(heroScore[0]);
    else if (need === 1) {
      for (const x of deck) {
        if (x === va || x === vb) continue;
        vc[6] = x;
        cmp(heroScore[x]);
      }
    } else {
      for (let i = 0; i < deck.length; i++) {
        const x = deck[i];
        if (x === va || x === vb) continue;
        vc[5] = x;
        for (let j = i + 1; j < deck.length; j++) {
          const y = deck[j];
          if (y === va || y === vb) continue;
          vc[6] = y;
          cmp(heroScore[x * 52 + y]);
        }
      }
    }
    win += w;
    tie += t;
    total += n;
    const pc = perClass[key] || (perClass[key] = { equity: 0, combos: 0 });
    pc.equity += (w + t / 2) / n;
    pc.combos++;
    if (onProgress && k % 50 === 49) onProgress((k + 1) / combos.length);
  }
  for (const pc of Object.values(perClass)) pc.equity /= pc.combos;

  return {
    equity: total ? (win + tie / 2) / total : 0,
    win: total ? win / total : 0,
    tie: total ? tie / total : 0,
    combos: combos.length,
    runouts: total,
    perClass,
  };
}
