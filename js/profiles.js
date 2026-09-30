// Villain profiles and their range charts. The ranges themselves live in
// data/ranges.csv so they are easy to read and edit; this module parses that
// file and picks the right chart for a given spot.

import { parseRange } from './cards.js';

export const PROFILES = {
  casual: {
    label: 'Casual',
    desc: 'Recreational. Limps and overlimps a lot, calls raises wide, rarely 3-bets.',
  },
  omc: {
    label: 'OMC',
    desc: 'Old man coffee. Only plays monsters: raises the top ~6% and folds the rest.',
  },
  pro: {
    label: 'Pro',
    desc: 'Solid regular with GTO-ish ranges. This chart is the grading baseline for your decisions.',
  },
  tilted: {
    label: 'Tilted',
    desc: 'Steaming. Opens and 3-bets far too wide, oversizes, rarely folds to aggression.',
  },
};
export const PROFILE_ORDER = ['casual', 'omc', 'pro', 'tilted'];

// CSV column -> the actions allowed for hands listed in it. Hands in no column fold.
export const COLUMNS = {
  raise: ['raise'],
  call: ['call'],
  raise_or_call: ['raise', 'call'],
  raise_or_fold: ['raise', 'fold'],
  call_or_fold: ['call', 'fold'],
};

const EARLY_POSITIONS = new Set(['UTG', 'UTG+1', 'UTG+2', 'LJ']);

function limpGroup(pos) {
  if (pos === 'UTG' || pos === 'UTG+1' || pos === 'UTG+2') return 'EP';
  if (pos === 'LJ' || pos === 'HJ') return 'MP';
  if (pos === 'CO' || pos === 'BTN') return 'LP';
  return pos; // SB, BB
}

// ---- Spot naming -----------------------------------------------------------

const KIND_LABEL = {
  rfi: 'Unopened pot (RFI)',
  limped: 'Facing limpers',
  vsOpen: 'Facing an open raise',
  vs3bet: 'Facing a 3-bet',
  vs4bet: 'Facing a 4-bet',
  vsAllin: 'Facing an all-in',
};

const QUALIFIER_LABEL = {
  EP: 'early position', MP: 'middle position', LP: 'CO/BTN', SB: 'small blind', BB: 'big blind (option)',
  IP_early: 'not in the blinds, vs UTG–LJ open', IP_late: 'not in the blinds, vs HJ–SB open',
  SB_early: 'small blind vs UTG–LJ open', SB_late: 'small blind vs HJ–SB open',
  BB_early: 'big blind vs UTG–LJ open', BB_late: 'big blind vs HJ–SB open',
  invested: 'already in the pot', cold: 'cold',
};

export function spotLabel(spot) {
  const [kind, qual, opponent] = spot.split('.');
  if (opponent) {
    const facing = kind === 'vsOpen' ? 'open' : kind === 'vs3bet' ? '3-bet' : kind === 'vsLimpRaise' ? 'raise after limping' : kind;
    return `${qual} vs ${opponent} ${facing}`;
  }
  const base = KIND_LABEL[kind] || kind;
  if (!qual) return `${base} — any position`;
  if (kind === 'rfi') return `${base} — ${qual}`;
  return `${base} — ${QUALIFIER_LABEL[qual] || qual}`;
}

// ---- CSV loading -------------------------------------------------------------

let CHARTS = null; // { profile: { spot: { spot, label, map, columns } } }

export function loadRanges(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const header = lines[0].split(',').map((s) => s.trim());
  const charts = {};
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] || '').trim()));
    if (!PROFILES[row.profile]) throw new Error(`Unknown profile "${row.profile}" in ranges.csv`);
    const map = new Map();
    const columns = {};
    for (const [col, acts] of Object.entries(COLUMNS)) {
      columns[col] = row[col] || '';
      for (const key of parseRange(row[col])) {
        if (map.has(key)) throw new Error(`${row.profile} ${row.spot}: ${key} listed in two columns`);
        map.set(key, acts);
      }
    }
    if (!charts[row.profile]) charts[row.profile] = {};
    charts[row.profile][row.spot] = { profile: row.profile, spot: row.spot, label: spotLabel(row.spot), map, columns };
  }
  CHARTS = charts;
  return charts;
}

export function allCharts() {
  return CHARTS;
}

// Candidate spot ids for a context, most specific first. A profile can define
// a position-specific row (e.g. "rfi.CO") or just a generic one ("rfi").
function spotCandidates(ctx) {
  switch (ctx.kind) {
    case 'rfi':
      return [`rfi.${ctx.pos === 'BB' ? 'SB' : ctx.pos}`, 'rfi'];
    case 'limped':
      return [`limped.${limpGroup(ctx.pos)}`, 'limped'];
    case 'vsOpen': {
      const grp = ctx.pos === 'SB' || ctx.pos === 'BB' ? ctx.pos : 'IP';
      const vs = EARLY_POSITIONS.has(ctx.raiserPos) ? 'early' : 'late';
      const exact = ctx.limpers === 0 && ctx.callers === 0
        ? [`vsOpen.${ctx.pos}.${ctx.raiserPos}`] : [];
      if (ctx.pos === 'SB' && ctx.raiserPos === 'BB' && ctx.selfLimped && ctx.cleanHeadsUp)
        exact.unshift('vsLimpRaise.SB.BB');
      return [...exact, `vsOpen.${grp}_${vs}`, 'vsOpen'];
    }
    case 'vs3bet': {
      const exact = ctx.wasOpener && ctx.limpers === 0 && ctx.cleanHeadsUp
        ? [`vs3bet.${ctx.pos}.${ctx.raiserPos}`] : [];
      return [...exact, `vs3bet.${ctx.invested ? 'invested' : 'cold'}`, 'vs3bet'];
    }
    default:
      return [`${ctx.kind}.${ctx.invested ? 'invested' : 'cold'}`, ctx.kind];
  }
}

export function lookup(profile, ctx) {
  const charts = CHARTS[profile] || {};
  for (const id of spotCandidates(ctx)) if (charts[id]) return charts[id];
  throw new Error(`No ${profile} chart for ${spotCandidates(ctx).join(' / ')}`);
}

// Map chart actions onto what is legal here: with no bet to call, "fold" means
// check; when raising isn't possible, "raise" means call.
export function normalize(acts, ctx) {
  const out = new Set();
  for (let a of acts) {
    if (a === 'fold' && ctx.toCall === 0) a = 'call';
    if (a === 'raise' && !ctx.canRaise) a = 'call';
    out.add(a);
  }
  return ['raise', 'call', 'fold'].filter((a) => out.has(a));
}

export function actionsFor(profile, ctx, key) {
  const chart = lookup(profile, ctx);
  return normalize(chart.map.get(key) || ['fold'], ctx);
}
