// Preflop hand simulation: deal, post blinds, walk the action seat by seat,
// pausing whenever it is the hero's turn.

import { newDeck, shuffle, handKey } from './cards.js';
import { actionsFor } from './profiles.js';
import { SB, BB, STACK, targetRaise } from './sizing.js';

export const POSITIONS = ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// Physical seat (0-8) that holds action-order position posIdx, given the button seat.
export const seatForPosition = (button, posIdx) => (button + 3 + posIdx) % 9;

export function createHand({ seatProfiles, button, heroSeat, rng = Math.random }) {
  const deck = shuffle(newDeck(), rng);
  const players = POSITIONS.map((pos, idx) => {
    const seat = seatForPosition(button, idx);
    const cards = [deck.pop(), deck.pop()];
    const isHero = seat === heroSeat;
    return {
      pos, idx, seat, isHero,
      profile: isHero ? null : seatProfiles[seat],
      cards, key: handKey(cards[0], cards[1]),
      stack: STACK, committed: 0,
      folded: false, allIn: false, acted: false,
      limped: false, investLevel: 0,
    };
  });
  const s = {
    players, pot: 0, currentBet: BB, minRaiseInc: BB, level: 1, lastRaiseTo: BB,
    raiserIdx: -1, callers: 0, toAct: 0, log: [], over: false, result: null,
    heroIdx: players.findIndex((p) => p.isHero),
  };
  post(s, 7, SB, 'posts SB $1');
  post(s, 8, BB, 'posts BB $2');
  return s;
}

function post(s, i, amt, text) {
  const p = s.players[i];
  p.stack -= amt;
  p.committed += amt;
  s.pot += amt;
  logAction(s, p, 'post', text);
}

function logAction(s, p, type, text) {
  s.log.push({ idx: p.idx, pos: p.pos, profile: p.profile, isHero: p.isHero, type, text });
}

export function getContext(s, i) {
  const p = s.players[i];
  const toCall = Math.max(0, s.currentBet - p.committed);
  const maxTo = p.committed + p.stack;
  const othersCanAct = s.players.some((q, j) => j !== i && !q.folded && !q.allIn);
  const limpers = s.players.filter((q) => q.limped).length;
  let kind;
  if (s.level >= 2 && toCall >= p.stack) kind = 'vsAllin';
  else if (s.level === 1) kind = limpers === 0 ? 'rfi' : 'limped';
  else kind = { 2: 'vsOpen', 3: 'vs3bet', 4: 'vs4bet' }[s.level] || 'vsAllin';
  const raiser = s.raiserIdx >= 0 ? s.players[s.raiserIdx] : null;
  const raises = s.log.filter((entry) => entry.type === 'raise');
  // A caller can also be invested: only the original raiser gets an opener's
  // response chart. Keep multiway pots on the existing broad fallback ranges.
  const wasOpener = raises.length > 0 && raises[0].idx === i;
  const cleanHeadsUp = !s.log.some((entry) =>
    entry.type === 'call' && entry.idx !== i && entry.idx !== s.raiserIdx);
  return {
    idx: i, pos: p.pos, kind, level: s.level,
    selfLimped: p.limped, wasOpener, cleanHeadsUp,
    toCall: Math.min(toCall, p.stack),
    checkOption: toCall === 0,
    canRaise: p.stack > toCall && othersCanAct,
    limpers, callers: s.callers,
    lastRaiseTo: s.lastRaiseTo, currentBet: s.currentBet,
    minRaiseTo: Math.min(s.currentBet + s.minRaiseInc, maxTo), maxTo,
    raiserPos: raiser ? raiser.pos : null,
    raiserProfile: raiser ? raiser.profile : null,
    invested: p.investLevel >= 2 && p.investLevel >= s.level - 1,
    pot: s.pot, committed: p.committed, stack: p.stack,
  };
}

function raiseVerb(level, limpers) {
  if (level === 1) return limpers ? 'raises' : 'opens';
  return { 2: '3-bets', 3: '4-bets', 4: '5-bets' }[level] || 're-raises';
}

// action: 'fold' | 'call' (also check / limp / complete) | 'raise'
export function applyAction(s, i, action, raiseTo) {
  const p = s.players[i];
  const ctx = getContext(s, i);
  if (action === 'raise' && !ctx.canRaise) action = 'call';
  if (action === 'fold' && ctx.toCall === 0) action = 'call';

  if (action === 'fold') {
    p.folded = true;
    logAction(s, p, 'fold', 'folds');
  } else if (action === 'call') {
    const amt = ctx.toCall;
    if (amt === 0) {
      logAction(s, p, 'check', 'checks');
    } else {
      move(s, p, amt);
      let verb;
      if (s.level === 1) {
        p.limped = true;
        verb = p.pos === 'SB' ? 'completes' : 'limps';
      } else {
        s.callers++;
        p.investLevel = s.level;
        verb = 'calls';
      }
      logAction(s, p, 'call', `${verb} $${p.committed}${p.allIn ? ' (all-in)' : ''}`);
    }
  } else {
    const asked = Number.isFinite(raiseTo) ? Math.round(raiseTo) : ctx.minRaiseTo;
    const to = Math.min(Math.max(asked, ctx.minRaiseTo), ctx.maxTo);
    const verb = raiseVerb(s.level, ctx.limpers);
    move(s, p, to - p.committed);
    s.minRaiseInc = Math.max(s.minRaiseInc, to - s.currentBet);
    s.currentBet = to;
    s.lastRaiseTo = to;
    s.level++;
    s.raiserIdx = i;
    s.callers = 0;
    p.investLevel = s.level;
    for (const q of s.players) if (q !== p) q.acted = false;
    logAction(s, p, 'raise', `${verb} to $${to}${p.allIn ? ' (all-in)' : ''}`);
  }
  p.acted = true;
  s.toAct = (i + 1) % 9;
}

function move(s, p, amt) {
  p.stack -= amt;
  p.committed += amt;
  s.pot += amt;
  if (p.stack === 0) p.allIn = true;
}

export function nextActor(s) {
  if (s.players.filter((p) => !p.folded).length <= 1) return -1;
  for (let k = 0; k < 9; k++) {
    const i = (s.toAct + k) % 9;
    const p = s.players[i];
    if (p.folded || p.allIn) continue;
    if (!p.acted || p.committed < s.currentBet) return i;
  }
  return -1;
}

// Tilted players oversize their raises some of the time.
function tiltSize(to, rng) {
  const raw = to * [1, 1.25, 1.5][Math.floor(rng() * 3)];
  return raw > 20 ? Math.round(raw / 5) * 5 : Math.round(raw);
}

function villainAct(s, i, rng) {
  const p = s.players[i];
  const ctx = getContext(s, i);
  const acts = actionsFor(p.profile, ctx, p.key);
  const action = acts[Math.floor(rng() * acts.length)];
  let to;
  if (action === 'raise') {
    to = targetRaise(ctx).to;
    if (p.profile === 'tilted' && ctx.level <= 3) to = tiltSize(to, rng);
  }
  applyAction(s, i, action, to);
}

// Run villain actions until the hero must act (returns hero's context) or the
// preflop round ends (returns null, with s.over / s.result set).
export function advance(s, rng = Math.random) {
  for (;;) {
    const i = nextActor(s);
    if (i < 0) {
      finish(s);
      return null;
    }
    if (s.players[i].isHero) {
      s.toAct = i;
      return getContext(s, i);
    }
    villainAct(s, i, rng);
  }
}

function finish(s) {
  s.over = true;
  const live = s.players.filter((p) => !p.folded);
  if (live.length === 1) {
    const w = live[0];
    const matched = Math.max(...s.players.filter((p) => p !== w).map((p) => p.committed));
    const uncalled = Math.max(0, w.committed - matched);
    s.result = { type: 'win', winner: w.idx, amount: s.pot - uncalled };
  } else {
    s.result = { type: live.some((p) => p.allIn) ? 'allin' : 'flop', players: live.map((p) => p.idx), pot: s.pot };
  }
}
