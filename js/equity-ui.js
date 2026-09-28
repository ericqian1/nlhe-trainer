// Equity screen: pick hero hand, board and villain hand/range, compute exact
// equity on demand, and turn it into EV-0 calling thresholds.

import { RANKS, gridKey, combosOf, comboCount, isRed, suitSymbol } from './cards.js';
import { PROFILES, PROFILE_ORDER, allCharts } from './profiles.js';
import { calcEquity, handName } from './equity.js';
import { $, h, fill, cardEl } from './dom.js';

const SUITS = ['s', 'h', 'd', 'c'];

const eq = {
  heroKey: null,
  hero: null, // ['As', '6h']
  board: [],
  mode: 'range', // 'range' | 'hand'
  range: new Set(),
  vKey: null,
  vHand: null,
  preset: '',
  presetUse: 'all',
  running: null, // { sig } while a computation is pending
  result: null, // { sig, ...calcEquity result }
  error: null,
};


// ---- derived state -------------------------------------------------------------

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

function deadFor(who) {
  const dead = new Set(eq.board);
  if (who !== 'hero' && eq.hero) eq.hero.forEach((c) => dead.add(c));
  if (who !== 'villain' && eq.mode === 'hand' && eq.vHand) eq.vHand.forEach((c) => dead.add(c));
  return dead;
}

function villainCombos() {
  const dead = deadFor('villain');
  const live = (combo) => !dead.has(combo[0]) && !dead.has(combo[1]);
  if (eq.mode === 'hand') return eq.vHand && live(eq.vHand) ? [eq.vHand] : [];
  return [...eq.range].flatMap((k) => combosOf(k)).filter(live);
}

function currentJob() {
  if (!eq.hero || eq.board.length < 3) return null;
  const villain = villainCombos();
  if (!villain.length) return null;
  return { hero: eq.hero, board: eq.board, villain };
}

const signature = (job) => (job ? JSON.stringify(job) : '');

function missing() {
  const out = [];
  if (!eq.hero) out.push(eq.heroKey ? 'pick the suits for your hand' : 'pick your hand');
  if (eq.board.length < 3) out.push(`pick ${3 - eq.board.length} more board card${eq.board.length === 2 ? '' : 's'} (flop)`);
  if (eq.mode === 'hand' && !eq.vHand) out.push(eq.vKey ? "pick the suits for villain's hand" : "pick villain's hand");
  if (eq.mode === 'range' && !villainCombos().length) out.push(eq.range.size ? 'villain range is fully blocked by your cards' : 'paint a villain range');
  return out;
}

// ---- compute -------------------------------------------------------------------

// Exact enumeration takes well under a second even for a full range on the
// flop, so it runs on the main thread; the timeout lets "Computing…" paint first.
function compute() {
  const job = currentJob();
  if (!job) return;
  eq.running = { sig: signature(job) };
  renderResult();
  setTimeout(() => {
    try {
      eq.result = { ...calcEquity(job), sig: eq.running.sig };
    } catch (err) {
      eq.result = null;
      console.error(err);
    }
    eq.running = null;
    renderResult();
  }, 30);
}

// ---- inputs changed ---------------------------------------------------------------

function changed() {
  renderHero();
  renderBoard();
  renderVillain();
  renderResult();
}

// ---- pickers ----------------------------------------------------------------------

function matrix(cellClass, attrs = {}) {
  const cells = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const key = gridKey(i, j);
      cells.push(h('div', { class: `cell ${cellClass(key)}`, 'data-key': key }, key));
    }
  }
  return h('div', { class: `grid pick ${attrs.class || ''}` }, cells);
}

function comboPicker(key, selected, dead, onPick) {
  if (!key) return null;
  return h('div', { class: 'combo-row' },
    combosOf(key).map((combo) => {
      const blocked = dead.has(combo[0]) || dead.has(combo[1]);
      return h('button', {
        class: `combo ${same(combo, selected) ? 'sel' : ''}`,
        disabled: blocked,
        title: blocked ? 'Blocked by a card already in use' : null,
        onclick: () => onPick(combo),
      }, combo.map((c) => cardEl(c, 'sm')));
    }));
}

function pickHint(key) {
  if (!key) return '';
  if (key.length === 2) return 'Pick the two suits:';
  return key[2] === 's' ? 'Pick the suit:' : 'Pick the suits:';
}

function renderHero() {
  const grid = matrix((k) => (k === eq.heroKey ? 'sel' : ''));
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    eq.heroKey = cell.dataset.key;
    const live = combosOf(eq.heroKey).filter((c) => !deadFor('hero').has(c[0]) && !deadFor('hero').has(c[1]));
    eq.hero = live.length === 1 ? live[0] : null;
    changed();
  });
  fill($('#eq-hero'),
    h('div', { class: 'eq-head' }, h('h2', null, 'Your hand'),
      eq.hero ? h('span', { class: 'hero-cards' }, eq.hero.map((c) => cardEl(c, 'lg'))) : h('span', { class: 'muted' }, 'pick a hand')),
    grid,
    eq.heroKey ? h('p', { class: 'muted small' }, `${eq.heroKey} — ${pickHint(eq.heroKey)}`) : null,
    comboPicker(eq.heroKey, eq.hero, deadFor('hero'), (combo) => {
      eq.hero = combo;
      changed();
    }));
}

function renderBoard() {
  const dead = deadFor('board');
  const rows = SUITS.map((s) => h('div', { class: 'deck-row' },
    [...RANKS].map((r) => {
      const card = r + s;
      const idx = eq.board.indexOf(card);
      return h('button', {
        'data-card': card,
        class: `dcard ${isRed(card) ? 'red' : ''} ${idx >= 0 ? 'sel' : ''}`,
        disabled: dead.has(card) && idx < 0,
        onclick: () => {
          if (idx >= 0) eq.board.splice(idx, 1);
          else if (eq.board.length < 5) eq.board.push(card);
          changed();
        },
      }, r, h('span', { class: 'suit' }, suitSymbol(card)));
    })));
  const slots = ['Flop', 'Flop', 'Flop', 'Turn', 'River'].map((label, i) =>
    h('div', { class: 'slot' }, eq.board[i] ? cardEl(eq.board[i], 'lg') : h('span', { class: 'pcard empty lg' }, '?'), h('small', null, label)));
  fill($('#eq-board'),
    h('div', { class: 'eq-head' }, h('h2', null, 'Board'),
      h('div', { class: 'row-tight' },
        h('button', { onclick: randomFlop }, 'Random flop'),
        h('button', { onclick: () => { eq.board = []; changed(); } }, 'Clear'))),
    h('div', { class: 'slots' }, slots),
    h('p', { class: 'muted small' }, 'Click cards in order: 3 for the flop, then turn and river. Click a picked card to remove it.'),
    h('div', { class: 'deck' }, rows));
}

function randomFlop() {
  const dead = deadFor('board');
  const pool = SUITS.flatMap((s) => [...RANKS].map((r) => r + s)).filter((c) => !dead.has(c));
  eq.board = [];
  while (eq.board.length < 3) {
    const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    eq.board.push(c);
  }
  changed();
}

// ---- villain -------------------------------------------------------------------

function presetOptions() {
  const charts = allCharts();
  return [h('option', { value: '' }, 'Load a range from the villain charts…'),
    PROFILE_ORDER.map((p) => h('optgroup', { label: PROFILES[p].label },
      Object.values(charts[p]).map((c) => h('option', { value: `${p}|${c.spot}`, selected: eq.preset === `${p}|${c.spot}` }, c.label))))];
}

function applyPreset() {
  if (!eq.preset) return;
  const [profile, spot] = eq.preset.split('|');
  const chart = allCharts()[profile][spot];
  const want = (acts) => (eq.presetUse === 'raise' ? acts.includes('raise') : eq.presetUse === 'call' ? acts.includes('call') : true);
  eq.range = new Set([...chart.map].filter(([, acts]) => want(acts)).map(([k]) => k));
  changed();
}

function rangeStats() {
  const classCombos = [...eq.range].reduce((n, k) => n + comboCount(k), 0);
  const live = eq.mode === 'range' ? villainCombos().length : 0;
  return `${eq.range.size} hands · ${classCombos} combos (${((100 * classCombos) / 1326).toFixed(1)}%) · ${live} live after card removal`;
}

function paintableGrid() {
  const grid = matrix((k) => (eq.range.has(k) ? 'in' : ''), { class: 'paint' });
  let painting = null;
  const apply = (cell) => {
    const k = cell.dataset.key;
    if (painting) eq.range.add(k);
    else eq.range.delete(k);
    cell.classList.toggle('in', painting);
    $('#eq-range-stats').textContent = rangeStats();
  };
  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    painting = !eq.range.has(cell.dataset.key);
    grid.setPointerCapture(e.pointerId);
    apply(cell);
  });
  grid.addEventListener('pointermove', (e) => {
    if (painting === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest('.cell');
    if (cell && grid.contains(cell) && eq.range.has(cell.dataset.key) !== painting) apply(cell);
  });
  const end = () => {
    if (painting === null) return;
    painting = null;
    eq.preset = '';
    changed();
  };
  grid.addEventListener('pointerup', end);
  grid.addEventListener('pointercancel', end);
  return grid;
}

function heatGrid() {
  const r = eq.result;
  const cells = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const key = gridKey(i, j);
      const pc = r.perClass[key];
      const style = pc ? `background:hsl(${Math.round(pc.equity * 120)} 65% 42%);color:#fff` : null;
      cells.push(h('div', {
        class: `cell ${pc ? '' : 'a-fold'}`,
        style,
        title: pc ? `${key}: you have ${(pc.equity * 100).toFixed(1)}% vs ${pc.combos} combo${pc.combos === 1 ? '' : 's'}` : key,
      }, key));
    }
  }
  return h('div', { class: 'chart' },
    h('div', { class: 'grid' }, cells),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'cell', style: 'background:hsl(0 65% 42%)' }), 'You are behind'),
      h('span', null, h('i', { class: 'cell', style: 'background:hsl(60 65% 42%)' }), 'Flip'),
      h('span', null, h('i', { class: 'cell', style: 'background:hsl(120 65% 42%)' }), 'You are ahead')));
}

function renderVillain() {
  const modeTabs = h('div', { class: 'tabs' },
    [['range', 'Range'], ['hand', 'Exact hand']].map(([m, label]) =>
      h('button', { class: eq.mode === m ? 'active' : '', onclick: () => { eq.mode = m; changed(); } }, label)));

  let body;
  if (eq.mode === 'range') {
    body = [
      h('div', { class: 'preset-row' },
        h('select', { 'aria-label': 'Preset range', onchange: (e) => { eq.preset = e.target.value; applyPreset(); } }, presetOptions()),
        h('select', { 'aria-label': 'Which part of the chart', onchange: (e) => { eq.presetUse = e.target.value; applyPreset(); } },
          [['all', 'raise + call'], ['raise', 'raise only'], ['call', 'call only']].map(([v, l]) => h('option', { value: v, selected: eq.presetUse === v }, l))),
        h('button', { onclick: () => { eq.range = new Set(); eq.preset = ''; changed(); } }, 'Clear')),
      h('p', { class: 'muted small' }, 'Click or drag across the grid to paint hands in or out of the range.'),
      paintableGrid(),
      h('p', { class: 'small', id: 'eq-range-stats' }, rangeStats()),
    ];
  } else {
    const grid = matrix((k) => (k === eq.vKey ? 'sel' : ''));
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      eq.vKey = cell.dataset.key;
      const dead = deadFor('villain');
      const live = combosOf(eq.vKey).filter((c) => !dead.has(c[0]) && !dead.has(c[1]));
      eq.vHand = live.length === 1 ? live[0] : null;
      changed();
    });
    body = [
      grid,
      eq.vKey ? h('p', { class: 'muted small' }, `${eq.vKey} — ${pickHint(eq.vKey)}`) : null,
      comboPicker(eq.vKey, eq.vHand, deadFor('villain'), (combo) => { eq.vHand = combo; changed(); }),
    ];
  }
  fill($('#eq-villain'),
    h('div', { class: 'eq-head' }, h('h2', null, 'Villain'),
      eq.mode === 'hand' && eq.vHand ? h('span', { class: 'hero-cards' }, eq.vHand.map((c) => cardEl(c, 'lg'))) : null),
    modeTabs, body);
}

// ---- results & EV -----------------------------------------------------------------

const num = (id) => {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const fmtBB = (bb) => `${Math.round(bb * 10) / 10}bb ($${Math.round(bb * 2)})`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// Pot P before the betting, hero already put in hb, villain bets/raises to R.
// Calling costs R - hb and the final pot is P + 2R.
function evFacing(E, P, hb, R) {
  const toCall = Math.max(0, R - hb);
  const finalPot = P + 2 * R;
  return { toCall, need: finalPot ? toCall / finalPot : 0, ev: E * finalPot - toCall };
}

function evSection(E) {
  const P = num('#eq-pot') || 0;
  const hb = num('#eq-hbet') || 0;
  const R = num('#eq-vbet');
  const parts = [];

  // EV-0: largest bet/raise-to where calling breaks even. E(P + 2R) = R - hb.
  if (E >= 0.5) {
    parts.push(h('div', { class: 'ev0 good' }, h('strong', null, 'Calling any size is +EV'),
      h('div', null, `With ${pct(E)} equity you're ahead of this range — every call wins money at showdown.`)));
  } else {
    const Rstar = (E * P + hb) / (1 - 2 * E);
    const callStar = Rstar - hb;
    parts.push(h('div', { class: 'ev0' },
      h('div', { class: 'muted small' }, hb ? 'Break-even (EV-0) raise size' : 'Break-even (EV-0) bet size'),
      h('div', { class: 'big-num' }, fmtBB(Rstar)),
      h('div', null, hb
        ? `Call a raise up to ${fmtBB(Rstar)} total (${fmtBB(callStar)} more). Bigger raises are a fold on pure equity.`
        : `Call a bet up to ${fmtBB(Rstar)} — ${Math.round((100 * Rstar) / (P || 1))}% of pot. Bigger bets are a fold on pure equity.`)));
  }

  if (R != null && R > hb) {
    const f = evFacing(E, P, hb, R);
    const good = f.ev >= 0;
    parts.push(h('div', { class: `facing ${good ? 'good' : 'bad'}` },
      h('strong', null, `Facing ${fmtBB(R)}: ${good ? 'Call' : 'Fold'}`),
      h('div', null, `Call ${fmtBB(f.toCall)} to win a ${fmtBB(P + 2 * R)} pot → need ${pct(f.need)}, have ${pct(E)}. EV of calling: ${f.ev >= 0 ? '+' : '−'}${fmtBB(Math.abs(f.ev))}.`)));
  }

  const sizes = hb
    ? [2, 2.5, 3, 4, 5].map((m) => ({ label: `${m}× raise`, R: m * hb }))
    : [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5, 2].map((m) => ({ label: `${Math.round(m * 100)}% pot`, R: m * P }));
  parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'ev-table' },
    h('thead', null, h('tr', null, ['Villain size', 'To call', 'Need', 'EV of call', ''].map((t) => h('th', null, t)))),
    h('tbody', null, sizes.map(({ label, R: r }) => {
      const f = evFacing(E, P, hb, r);
      return h('tr', { class: f.ev >= 0 ? 'good' : 'bad' },
        h('td', null, `${label} (${Math.round(r * 10) / 10}bb)`),
        h('td', null, `${Math.round(f.toCall * 10) / 10}bb`),
        h('td', null, pct(f.need)),
        h('td', null, `${f.ev >= 0 ? '+' : '−'}${Math.abs(Math.round(f.ev * 10) / 10)}bb`),
        h('td', null, f.ev >= 0 ? 'call' : 'fold'));
    })))));
  parts.push(h('p', { class: 'muted small' },
    'Equity is your share of the pot if all remaining cards are dealt with no more betting. EV-0 treats this call as the last money in — implied odds and future bets are not included.'));
  return parts;
}

function renderResult() {
  const job = currentJob();
  const sig = signature(job);
  const r = eq.result;
  const fresh = r && r.sig === sig;
  const need = missing();

  const button = h('button', {
    class: 'primary big',
    disabled: !job || !!eq.running,
    onclick: compute,
  }, eq.running ? 'Computing…' : fresh ? 'Recompute' : 'Compute equity');

  const kids = [h('h2', null, 'Equity'), button];
  if (need.length) kids.push(h('p', { class: 'muted' }, `To compute: ${need.join(', ')}.`));
  else if (!fresh && !eq.running) kids.push(h('p', { class: 'muted' }, r ? 'Inputs changed — press Compute to update.' : `${job.villain.length} villain combo${job.villain.length === 1 ? '' : 's'} × every runout.`));

  if (fresh) {
    const made = handName(eq.hero.concat(eq.board));
    kids.push(
      h('div', { class: 'eq-big' },
        h('div', { class: 'big-num' }, pct(r.equity)),
        h('div', { class: 'muted' }, `You have ${made.toLowerCase()} · vs ${r.combos} combo${r.combos === 1 ? '' : 's'} · ${r.runouts.toLocaleString()} showdowns`)),
      h('div', { class: 'wtl' },
        h('span', { class: 'w', style: `flex:${r.win}` }), h('span', { class: 't', style: `flex:${r.tie}` }), h('span', { class: 'l', style: `flex:${1 - r.win - r.tie}` })),
      h('div', { class: 'wtl-legend small' }, `Win ${pct(r.win)} · Tie ${pct(r.tie)} · Lose ${pct(1 - r.win - r.tie)}`),
      evSection(r.equity),
      eq.mode === 'range' && r.combos > 1 ? h('details', { open: true }, h('summary', null, 'Your equity vs each hand in the range'), heatGrid()) : null,
    );
  }
  fill($('#eq-result'), kids);
}

// ---- entry points ----------------------------------------------------------------

export function initEquity() {
  for (const id of ['#eq-pot', '#eq-hbet', '#eq-vbet']) $(id).addEventListener('input', renderResult);
}

export function renderEquity() {
  changed();
}
