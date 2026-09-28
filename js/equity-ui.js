// Equity screen: pick hero hand, board and villain hand/range, compute exact
// equity on demand, and turn it into EV-0 calling thresholds.

import { RANKS, gridKey, combosOf, comboCount, isRed, suitSymbol } from './cards.js';
import { PROFILES, PROFILE_ORDER, allCharts } from './profiles.js';
import { calcEquity, handName } from './equity.js';
import { $, h, fill, cardEl } from './dom.js';

const SUITS = ['s', 'h', 'd', 'c'];

const eq = {
  hero: [], // up to 2 cards, e.g. ['As', '6h']
  board: [], // 0-5 cards
  mode: 'range', // 'range' | 'hand'
  range: new Set(),
  vHand: [], // villain's exact hand, up to 2 cards
  preset: '',
  presetUse: 'all',
  running: null, // { sig } while a computation is pending
  result: null, // { sig, ...calcEquity result }
  error: null,
};

// ---- derived state -------------------------------------------------------------

// Cards unavailable to `who` because another input already uses them.
function deadFor(who) {
  const dead = new Set();
  if (who !== 'board') eq.board.forEach((c) => dead.add(c));
  if (who !== 'hero') eq.hero.forEach((c) => dead.add(c));
  if (who !== 'villain' && eq.mode === 'hand') eq.vHand.forEach((c) => dead.add(c));
  return dead;
}

function villainCombos() {
  const dead = deadFor('villain');
  const live = (combo) => !dead.has(combo[0]) && !dead.has(combo[1]);
  if (eq.mode === 'hand') return eq.vHand.length === 2 && live(eq.vHand) ? [eq.vHand] : [];
  return [...eq.range].flatMap((k) => combosOf(k)).filter(live);
}

function currentJob() {
  // Board must be empty (preflop) or at least a full flop.
  if (eq.hero.length < 2 || (eq.board.length > 0 && eq.board.length < 3)) return null;
  const villain = villainCombos();
  if (!villain.length) return null;
  return { hero: eq.hero, board: eq.board, villain };
}

const signature = (job) => (job ? JSON.stringify(job) : '');

function missing() {
  const out = [];
  if (eq.hero.length < 2) out.push(`pick ${2 - eq.hero.length} more card${eq.hero.length ? '' : 's'} for your hand`);
  if (eq.board.length > 0 && eq.board.length < 3) out.push(`pick ${3 - eq.board.length} more board card${eq.board.length === 2 ? '' : 's'} for the flop, or clear the board for preflop`);
  if (eq.mode === 'hand' && eq.vHand.length < 2) out.push(`pick ${2 - eq.vHand.length} more card${eq.vHand.length ? '' : 's'} for villain`);
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

// Shared 52-card picker. Clicking a picked card removes it; clicking a new card
// adds it, or replaces the last one when all slots are full.
function cardPicker(cards, slotLabels, who) {
  const dead = deadFor(who);
  const max = slotLabels.length;
  const rows = SUITS.map((s) => h('div', { class: 'deck-row' },
    [...RANKS].map((r) => {
      const card = r + s;
      const idx = cards.indexOf(card);
      return h('button', {
        'data-card': card,
        class: `dcard ${isRed(card) ? 'red' : ''} ${idx >= 0 ? 'sel' : ''}`,
        disabled: dead.has(card),
        onclick: () => {
          if (idx >= 0) cards.splice(idx, 1);
          else if (cards.length < max) cards.push(card);
          else cards[max - 1] = card;
          changed();
        },
      }, r, h('span', { class: 'suit' }, suitSymbol(card)));
    })));
  const slots = slotLabels.map((label, i) =>
    h('div', { class: 'slot' }, cards[i] ? cardEl(cards[i], 'lg') : h('span', { class: 'pcard empty lg' }, '?'), label ? h('small', null, label) : null));
  return [h('div', { class: 'slots' }, slots), h('div', { class: 'deck' }, rows)];
}

const clearButton = (onclick) => h('button', { onclick }, 'Clear');

function renderHero() {
  const [slots, deck] = cardPicker(eq.hero, ['', ''], 'hero');
  fill($('#eq-hero'),
    h('div', { class: 'eq-head' }, h('h2', null, 'Your hand'), clearButton(() => { eq.hero = []; changed(); })),
    slots, deck);
}

function renderBoard() {
  const [slots, deck] = cardPicker(eq.board, ['Flop', 'Flop', 'Flop', 'Turn', 'River'], 'board');
  fill($('#eq-board'),
    h('div', { class: 'eq-head' }, h('h2', null, 'Board'),
      h('div', { class: 'row-tight' },
        h('button', { onclick: randomFlop }, 'Random flop'),
        clearButton(() => { eq.board = []; changed(); }))),
    slots,
    h('p', { class: 'muted small' }, 'Leave empty for preflop equity, or pick 3 cards for the flop, then the turn and river. Click a picked card to remove it.'),
    deck);
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
    const [slots, deck] = cardPicker(eq.vHand, ['', ''], 'villain');
    body = [h('div', { class: 'eq-head' }, slots, clearButton(() => { eq.vHand = []; changed(); })), deck];
  }
  fill($('#eq-villain'), h('h2', null, 'Villain'), modeTabs, body);
}

// ---- results & EV -----------------------------------------------------------------

// Amounts are kept in bb internally; the unit toggle only changes what the
// inputs mean and how results are shown (1bb = $2).
const UNIT_KEY = 'nlhe-trainer:equity-unit';
const USD_PER_BB = 2;
const AMOUNT_INPUTS = ['#eq-pot', '#eq-vbet', '#eq-hbet'];
let unit = 'bb';

const num = (id) => {
  const v = parseFloat($(id).value);
  if (!Number.isFinite(v) || v < 0) return null;
  return unit === '$' ? v / USD_PER_BB : v;
};
const round1 = (x) => Math.round(x * 10) / 10;
const fmtBB = (bb) => (unit === '$' ? `$${round1(bb * USD_PER_BB)}` : `${round1(bb)}bb`);

function setUnit(next) {
  if (next === unit) return;
  const factor = next === '$' ? USD_PER_BB : 1 / USD_PER_BB;
  for (const id of AMOUNT_INPUTS) {
    const v = parseFloat($(id).value);
    if (Number.isFinite(v)) $(id).value = round1(v * factor);
  }
  unit = next;
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch (e) { /* storage unavailable */ }
  renderUnit();
  renderResult();
}

function renderUnit() {
  for (const b of document.querySelectorAll('#eq-unit button')) b.classList.toggle('active', b.dataset.unit === unit);
  for (const el of document.querySelectorAll('.unit-pre')) el.textContent = unit === '$' ? '$' : '';
  for (const el of document.querySelectorAll('.unit-post')) el.textContent = unit === '$' ? '' : 'bb';
}
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
        h('td', null, `${label} (${fmtBB(r)})`),
        h('td', null, fmtBB(f.toCall)),
        h('td', null, pct(f.need)),
        h('td', null, `${f.ev >= 0 ? '+' : '−'}${fmtBB(Math.abs(f.ev))}`),
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
    const street = ['Preflop', '', '', 'Flop', 'Turn', 'River'][eq.board.length];
    const made = eq.board.length ? `You have ${handName(eq.hero.concat(eq.board)).toLowerCase()}` : street;
    const sample = r.exact
      ? `${r.runouts.toLocaleString()} showdowns (exact)`
      : `${r.runouts.toLocaleString()} simulated boards · ±${(r.margin * 100).toFixed(1)}%`;
    kids.push(
      h('div', { class: 'eq-big' },
        h('div', { class: 'big-num' }, pct(r.equity)),
        h('div', { class: 'muted' }, `${made} · vs ${r.combos} combo${r.combos === 1 ? '' : 's'} · ${sample}`)),
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
  for (const id of AMOUNT_INPUTS) $(id).addEventListener('input', renderResult);
  for (const b of document.querySelectorAll('#eq-unit button')) b.addEventListener('click', () => setUnit(b.dataset.unit));
  let saved = null;
  try {
    saved = localStorage.getItem(UNIT_KEY);
  } catch (e) { /* storage unavailable */ }
  // The inputs start out in bb; converting through setUnit keeps them consistent.
  if (saved === '$') setUnit('$');
  else renderUnit();
}

export function renderEquity() {
  changed();
}
