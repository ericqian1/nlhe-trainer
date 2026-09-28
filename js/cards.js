// Cards, deck, 169-hand grid, and range-string parsing.

export const RANKS = 'AKQJT98765432'; // index 0 = Ace (strongest)
export const SUITS = 'shdc';

const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };

export const rankIndex = (r) => RANKS.indexOf(r);
export const suitSymbol = (card) => SUIT_SYMBOL[card[1]];
export const isRed = (card) => card[1] === 'h' || card[1] === 'd';

export function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Two cards like 'As', '5s' -> canonical hand key like 'A5s', 'KQo', '77'.
export function handKey(a, b) {
  let r1 = a[0];
  let r2 = b[0];
  if (rankIndex(r1) > rankIndex(r2)) [r1, r2] = [r2, r1];
  if (r1 === r2) return r1 + r2;
  return r1 + r2 + (a[1] === b[1] ? 's' : 'o');
}

// Standard 13x13 grid: pairs on the diagonal, suited above, offsuit below.
export function gridKey(row, col) {
  if (row === col) return RANKS[row] + RANKS[col];
  if (row < col) return RANKS[row] + RANKS[col] + 's';
  return RANKS[col] + RANKS[row] + 'o';
}

export const ALL_HANDS = [];
for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) ALL_HANDS.push(gridKey(i, j));

export function comboCount(key) {
  if (key.length === 2) return 6;
  return key[2] === 's' ? 4 : 12;
}

// ---- Range parsing -------------------------------------------------------
// Supports: 77+, 55-22, QQ, A9s+, KTo+, AJ+, A5s-A2s, AKs, AKo, AK

function kickersBetween(hi, a, b) {
  let i = rankIndex(a);
  let j = rankIndex(b);
  if (i > j) [i, j] = [j, i];
  const out = [];
  for (let k = i; k <= j; k++) {
    if (k <= rankIndex(hi)) throw new Error(`Kicker ${RANKS[k]} not below ${hi}`);
    out.push(RANKS[k]);
  }
  return out;
}

function withSuffix(hi, lo, suffix) {
  return suffix ? [hi + lo + suffix] : [hi + lo + 's', hi + lo + 'o'];
}

function expandToken(tok) {
  let m;
  if ((m = tok.match(/^([AKQJT2-9])\1\+$/))) {
    const out = [];
    for (let k = 0; k <= rankIndex(m[1]); k++) out.push(RANKS[k] + RANKS[k]);
    return out;
  }
  if ((m = tok.match(/^([AKQJT2-9])\1-([AKQJT2-9])\2$/))) {
    let i = rankIndex(m[1]);
    let j = rankIndex(m[2]);
    if (i > j) [i, j] = [j, i];
    const out = [];
    for (let k = i; k <= j; k++) out.push(RANKS[k] + RANKS[k]);
    return out;
  }
  if ((m = tok.match(/^([AKQJT2-9])\1$/))) return [tok];
  if ((m = tok.match(/^([AKQJT2-9])([AKQJT2-9])([so]?)\+$/))) {
    const [, hi, lo, suffix] = m;
    return kickersBetween(hi, lo, RANKS[rankIndex(hi) + 1]).flatMap((k) => withSuffix(hi, k, suffix));
  }
  if ((m = tok.match(/^([AKQJT2-9])([AKQJT2-9])([so]?)-\1([AKQJT2-9])\3$/))) {
    const [, hi, a, suffix, b] = m;
    return kickersBetween(hi, a, b).flatMap((k) => withSuffix(hi, k, suffix));
  }
  if ((m = tok.match(/^([AKQJT2-9])([AKQJT2-9])([so]?)$/))) {
    const [, hi, lo, suffix] = m;
    if (rankIndex(hi) >= rankIndex(lo)) throw new Error(`Bad range token "${tok}"`);
    return withSuffix(hi, lo, suffix);
  }
  throw new Error(`Bad range token "${tok}"`);
}

export function parseRange(str) {
  const set = new Set();
  for (const raw of (str || '').split(/[\s,]+/)) {
    const tok = raw.trim();
    if (tok) for (const k of expandToken(tok)) set.add(k);
  }
  return set;
}

// All specific two-card combos for a hand class, e.g. 'AKs' -> [['As','Ks'], ...].
export function combosOf(key) {
  const [r1, r2] = key;
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (key.length === 2 ? j <= i : key[2] === 's' ? j !== i : j === i) continue;
      out.push([r1 + SUITS[i], r2 + SUITS[j]]);
    }
  }
  return out;
}
