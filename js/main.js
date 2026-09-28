import { PROFILES, PROFILE_ORDER, loadRanges, allCharts } from './profiles.js';
import { createHand, advance, applyAction } from './engine.js';
import { gradeDecision } from './grade.js';
import { RANKS, gridKey, suitSymbol, isRed, comboCount } from './cards.js';

const STORE_KEY = 'nlhe-trainer:table:v1';
const DEFAULT_TABLE = ['casual', 'omc', 'casual', 'pro', 'tilted', 'casual', 'omc', 'pro', 'casual'];

const app = {
  screen: 'train',
  table: null,
  draft: null, // counts being edited on the setup screen
  tableDirty: false,
  button: Math.floor(Math.random() * 9),
  hand: null,
  ctx: null, // hero's decision context, null when hero isn't to act
  feedback: [],
  stats: { decisions: 0, correct: 0, raises: 0, exact: 0, close: 0 },
  rangeProfile: 'pro',
};

// ---- small DOM helpers ------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : String(c));
  }
  return e;
}

const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
const money = (n) => `$${n}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function cardEl(card, cls = '') {
  return h('span', { class: `pcard ${isRed(card) ? 'red' : ''} ${cls}` }, card[0], h('span', { class: 'suit' }, suitSymbol(card)));
}

function profileBadge(profile) {
  if (!profile) return h('span', { class: 'badge hero' }, 'You');
  return h('span', { class: `badge prof-${profile}` }, PROFILES[profile].label);
}

// ---- persistence --------------------------------------------------------------

function loadTable() {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(t) && t.length === 9 && t.every((p) => PROFILES[p])) return t;
  } catch (e) { /* storage unavailable */ }
  return null;
}

function saveTable() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(app.table));
  } catch (e) { /* storage unavailable */ }
  app.tableDirty = true;
}

// ---- action naming --------------------------------------------------------------

function actionName(action, ctx) {
  if (action === 'fold') return 'Fold';
  if (action === 'call') {
    if (ctx.checkOption) return 'Check';
    if (ctx.level === 1) return ctx.pos === 'SB' ? 'Complete' : 'Limp';
    return ctx.toCall >= ctx.stack ? 'Call all-in' : 'Call';
  }
  if (ctx.level === 1) return ctx.limpers ? 'Iso-raise' : 'Open';
  return { 2: '3-bet', 3: '4-bet', 4: '5-bet' }[ctx.level] || 'Re-raise';
}

// ---- screens ----------------------------------------------------------------------

function showScreen(name) {
  app.screen = name;
  history.replaceState(null, '', `#${name}`);
  for (const s of ['train', 'ranges', 'setup']) $(`#screen-${s}`).hidden = s !== name;
  for (const b of document.querySelectorAll('nav.tabs button')) b.classList.toggle('active', b.dataset.screen === name);
  if (name === 'train') {
    if (!app.hand || (app.tableDirty && app.hand.over)) nextHand();
    else renderTrain();
  }
  if (name === 'ranges') renderRanges();
  if (name === 'setup') renderSetup();
}

function renderStats() {
  const s = app.stats;
  const pct = s.decisions ? Math.round((100 * s.correct) / s.decisions) : 0;
  fill($('#stats'), 
    h('span', null, 'Decisions ', h('strong', null, `${s.correct}/${s.decisions}`), s.decisions ? ` (${pct}%)` : ''),
    h('span', null, 'Sizing ', h('strong', null, `${s.exact}/${s.raises}`), ' exact', s.close ? ` · ${s.close} close` : ''),
    h('button', { class: 'link', title: 'Reset session stats', onclick: () => {
      app.stats = { decisions: 0, correct: 0, raises: 0, exact: 0, close: 0 };
      renderStats();
    } }, 'reset'),
  );
}

// ---- training loop ----------------------------------------------------------------

function nextHand() {
  app.tableDirty = false;
  app.button = (app.button + 1) % 9;
  const heroSeat = Math.floor(Math.random() * 9);
  app.hand = createHand({ seatProfiles: app.table, button: app.button, heroSeat });
  app.feedback = [];
  app.ctx = advance(app.hand);
  renderTrain();
}

function heroAct(action, raiseTo) {
  const s = app.hand;
  const ctx = app.ctx;
  if (!ctx || s.over) return;
  const hero = s.players[s.heroIdx];
  if (action === 'raise') raiseTo = Math.min(raiseTo, ctx.maxTo);
  const g = gradeDecision(ctx, hero.key, action, raiseTo);

  app.stats.decisions++;
  if (g.correct) app.stats.correct++;
  if (g.sizing) {
    app.stats.raises++;
    if (g.sizing.grade === 'exact') app.stats.exact++;
    if (g.sizing.grade === 'close') app.stats.close++;
  }
  app.feedback.push({ ctx, action, raiseTo, g, key: hero.key });

  applyAction(s, s.heroIdx, action, raiseTo);
  app.ctx = advance(s);
  renderTrain();
}

function submitRaise() {
  const ctx = app.ctx;
  const input = $('#raise-input');
  const err = $('#raise-error');
  const raw = input.value.replace(/[$,\s]/g, '');
  const amt = Number(raw);
  if (!raw || !Number.isFinite(amt)) {
    err.textContent = 'Enter a raise-to amount in dollars.';
    input.focus();
    return;
  }
  if (amt < ctx.minRaiseTo && amt < ctx.maxTo) {
    err.textContent = `Minimum raise is to $${ctx.minRaiseTo}.`;
    input.focus();
    return;
  }
  heroAct('raise', Math.round(amt));
}

function renderTrain() {
  renderStats();
  renderFelt();
  renderLog();
  renderSpot();
  renderDecision();
  renderFeedback();
}

function seatXY(k, rx, ry) {
  const a = ((90 + k * 40) * Math.PI) / 180;
  return [50 + rx * Math.cos(a), 50 + ry * Math.sin(a)];
}

function renderFelt() {
  const s = app.hand;
  const felt = $('#felt');
  const heroSeat = s.players[s.heroIdx].seat;
  const nodes = [h('div', { class: 'felt-center' }, h('div', { class: 'pot-label' }, 'Pot'), h('div', { class: 'pot' }, money(s.pot)))];
  for (let k = 0; k < 9; k++) {
    const seat = (heroSeat + k) % 9;
    const p = s.players.find((q) => q.seat === seat);
    const [x, y] = seatXY(k, 43, 40);
    const [bx, by] = seatXY(k, 27, 22);
    const showCards = p.isHero || (s.over && !p.folded);
    const cards = showCards
      ? p.cards.map((c) => cardEl(c, p.isHero ? '' : 'sm'))
      : p.folded ? [] : [h('span', { class: 'pcard back sm' }), h('span', { class: 'pcard back sm' })];
    nodes.push(h('div', {
      class: `seat ${p.isHero ? 'hero' : `prof-${p.profile}`} ${p.folded ? 'folded' : ''} ${app.ctx && p.isHero ? 'acting' : ''}`,
      style: `left:${x}%;top:${y}%`,
    },
    h('div', { class: 'seat-top' }, h('span', { class: 'seat-pos' }, p.pos), p.pos === 'BTN' ? h('span', { class: 'dealer', title: 'Button' }, 'D') : null),
    h('div', { class: 'seat-name' }, p.isHero ? 'You' : PROFILES[p.profile].label),
    h('div', { class: 'seat-cards' }, cards),
    h('div', { class: 'seat-stack' }, p.allIn ? 'all-in' : money(p.stack))));
    if (p.committed > 0) nodes.push(h('div', { class: 'bet', style: `left:${bx}%;top:${by}%` }, money(p.committed)));
  }
  fill(felt, ...nodes);
}

function resultText(s) {
  const r = s.result;
  const who = (p) => (p.isHero ? 'You' : `${p.pos} (${PROFILES[p.profile].label})`);
  if (r.type === 'win') {
    const w = s.players[r.winner];
    return w.isHero ? `Everyone folds — you win $${r.amount}.` : `${who(w)} wins $${r.amount} uncontested.`;
  }
  const names = r.players.map((i) => (s.players[i].isHero ? 'you' : s.players[i].pos)).join(', ');
  return r.type === 'allin'
    ? `All-in preflop: ${names} — pot $${r.pot}.`
    : `${plural(r.players.length, 'player')} see the flop (${names}) — pot $${r.pot}.`;
}

function renderLog() {
  const s = app.hand;
  const items = s.log.map((e) => h('li', { class: `${e.isHero ? 'hero' : ''} ${e.type}` },
    h('span', { class: 'log-pos' }, e.pos), profileBadge(e.profile), h('span', { class: 'log-text' }, e.text)));
  if (s.over) items.push(h('li', { class: 'result' }, resultText(s)));
  const ol = $('#log');
  fill(ol, ...items);
  ol.scrollTop = ol.scrollHeight;
}

function describeSpot(ctx) {
  const s = app.hand;
  const lastRaise = [...s.log].reverse().find((e) => e.type === 'raise');
  const raiseLine = lastRaise ? `${lastRaise.pos} (${lastRaise.isHero ? 'you' : PROFILES[lastRaise.profile].label}) ${lastRaise.text}` : '';
  const callers = ctx.callers ? `, ${plural(ctx.callers, 'caller')}` : '';
  switch (ctx.kind) {
    case 'rfi':
      return 'Folded to you — unopened pot.';
    case 'limped':
      return `${plural(ctx.limpers, 'limper')} in front.${ctx.checkOption ? ' You have the option.' : ''}`;
    case 'vsOpen':
      return `${raiseLine}${callers}.`;
    case 'vs3bet':
    case 'vs4bet':
      return `${raiseLine}${callers}. ${ctx.invested ? "You're already in the pot." : 'You have not put money in yet.'}`;
    default:
      return `${raiseLine}${callers}. Calling puts you all-in.`;
  }
}

function renderSpot() {
  const s = app.hand;
  const hero = s.players[s.heroIdx];
  const ctx = app.ctx;
  let desc;
  if (ctx) desc = describeSpot(ctx);
  else if (!app.feedback.length && s.result.type === 'win' && s.result.winner === s.heroIdx) desc = 'Folded around to you in the big blind — a walk. No decision this hand.';
  else desc = resultText(s);
  fill($('#spot'), 
    h('div', { class: 'spot-head' },
      h('span', { class: 'pos-chip' }, hero.pos),
      h('span', { class: 'hero-cards' }, hero.cards.map((c) => cardEl(c, 'lg'))),
      h('span', { class: 'hand-key' }, hero.key)),
    h('p', { class: 'spot-desc' }, desc),
    ctx ? h('div', { class: 'spot-nums' },
      h('span', null, 'Pot ', h('strong', null, money(ctx.pot))),
      h('span', null, 'To call ', h('strong', null, money(ctx.toCall))),
      h('span', null, 'Your stack ', h('strong', null, money(ctx.stack)))) : null,
  );
}

function renderDecision() {
  const s = app.hand;
  const ctx = app.ctx;
  const box = $('#decision');
  if (!ctx) {
    fill(box, h('button', { class: 'primary big', onclick: nextHand }, 'Next hand ', h('kbd', null, 'Enter')));
    return;
  }
  const buttons = [];
  if (!ctx.checkOption) buttons.push(h('button', { class: 'act fold', onclick: () => heroAct('fold') }, 'Fold ', h('kbd', null, 'F')));
  buttons.push(h('button', { class: 'act call', onclick: () => heroAct('call') },
    actionName('call', ctx), ctx.toCall ? ` $${ctx.toCall}` : '', ' ', h('kbd', null, 'C')));
  const raise = ctx.canRaise
    ? h('div', { class: 'raise-row' },
      h('label', { for: 'raise-input' }, `${actionName('raise', ctx)} to`),
      h('div', { class: 'money-input' }, h('span', null, '$'),
        h('input', { id: 'raise-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'amount',
          onkeydown: (e) => {
            if (e.key === 'Enter') submitRaise();
            if (e.key === 'Escape') e.target.blur();
          } })),
      h('button', { class: 'act raise', onclick: submitRaise }, actionName('raise', ctx), ' ', h('kbd', null, 'R')))
    : null;
  fill(box, 
    h('div', { class: 'act-row' }, buttons),
    raise,
    ctx.canRaise ? h('p', { class: 'hint' }, `Min raise to $${ctx.minRaiseTo} · all-in is $${ctx.maxTo}. Type the total you raise to.`) : null,
    h('p', { class: 'error', id: 'raise-error' }),
  );
}

function renderFeedback() {
  const list = $('#feedback');
  fill(list, ...app.feedback.map((f) => feedbackCard(f)).reverse());
}

function feedbackCard(f) {
  const { g, ctx, action, raiseTo } = f;
  const verdict = g.correct ? (g.mixed ? 'Correct — mixed spot' : 'Correct') : 'Mistake';
  const you = action === 'raise' ? `${actionName('raise', ctx)} to $${raiseTo}` : actionName(action, ctx);
  const pro = g.proActs.map((a) => actionName(a, ctx)).join(' or ');

  let sizing = null;
  if (g.sizing) {
    const { grade, diff } = g.sizing;
    const off = diff === 0 ? '' : ` (${diff > 0 ? '+' : '−'}$${Math.abs(diff)})`;
    sizing = h('div', { class: `sizing ${grade}` },
      h('strong', null, `Sizing: ${grade}${grade === 'exact' ? '' : off}`),
      h('div', null, `Target $${g.target.to} — ${g.target.formula}`));
  } else if (g.target && g.proActs.includes('raise')) {
    sizing = h('div', { class: 'sizing info' }, `If raising: $${g.target.to} — ${g.target.formula}`);
  }

  return h('div', { class: `card fb ${g.correct ? 'ok' : 'bad'}` },
    h('div', { class: 'fb-head' },
      h('span', { class: 'verdict' }, verdict),
      h('span', { class: 'muted' }, `${ctx.pos} · ${f.key}`)),
    h('p', null, 'You: ', h('strong', null, you), ' · Pro: ', h('strong', null, pro)),
    sizing,
    h('details', { open: !g.correct },
      h('summary', null, `Pro chart: ${g.chart.label}`),
      chartGrid(g.chart, f.key, ctx)));
}

// ---- 13x13 chart rendering ------------------------------------------------------------

const ACT_CLASS = (acts) => ['raise', 'call', 'fold'].filter((a) => acts.includes(a)).join('-');

function chartGrid(chart, highlightKey, ctx) {
  const cells = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const key = gridKey(i, j);
      let acts = chart.map.get(key) || ['fold'];
      if (ctx && ctx.checkOption) acts = acts.map((a) => (a === 'fold' ? 'call' : a));
      if (ctx && !ctx.canRaise) acts = acts.map((a) => (a === 'raise' ? 'call' : a));
      cells.push(h('div', { class: `cell a-${ACT_CLASS(acts)} ${key === highlightKey ? 'me' : ''}`, title: `${key}: ${acts.join(' / ')}` }, key));
    }
  }
  return h('div', { class: 'chart' }, h('div', { class: 'grid' }, cells), legend(chart));
}

function legend(chart) {
  const combos = {};
  for (const [k, acts] of chart.map) combos[ACT_CLASS(acts)] = (combos[ACT_CLASS(acts)] || 0) + comboCount(k);
  const names = { raise: 'Raise', call: 'Call', 'raise-call': 'Raise / call', 'raise-fold': 'Raise / fold', 'call-fold': 'Call / fold' };
  return h('div', { class: 'legend' },
    Object.keys(names).filter((c) => combos[c]).map((c) =>
      h('span', null, h('i', { class: `cell a-${c}` }), `${names[c]} ${((100 * combos[c]) / 1326).toFixed(1)}%`)),
    h('span', null, h('i', { class: 'cell a-fold' }), 'Fold'));
}

// ---- ranges screen ------------------------------------------------------------------

function renderRanges() {
  fill($('#range-tabs'), ...PROFILE_ORDER.map((p) =>
    h('button', { class: `${app.rangeProfile === p ? 'active' : ''} prof-${p}`, onclick: () => {
      app.rangeProfile = p;
      renderRanges();
    } }, PROFILES[p].label)));
  $('#range-desc').textContent = PROFILES[app.rangeProfile].desc;
  const charts = Object.values(allCharts()[app.rangeProfile]);
  fill($('#range-charts'), ...charts.map((c) =>
    h('div', { class: 'card range-card' },
      h('h3', null, c.label),
      h('code', { class: 'spot-id' }, `${c.profile},${c.spot}`),
      chartGrid(c),
      h('details', null, h('summary', null, 'CSV row'),
        h('dl', { class: 'csv-row' }, Object.entries(c.columns).filter(([, v]) => v)
          .map(([col, v]) => [h('dt', null, col), h('dd', null, v)]))))));
}

// ---- setup screen ------------------------------------------------------------------

const countsOf = (table) => Object.fromEntries(PROFILE_ORDER.map((p) => [p, table.filter((t) => t === p).length]));

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderSetup() {
  const draft = app.draft || countsOf(app.table);
  const total = Object.values(draft).reduce((a, b) => a + b, 0);
  const setCount = (p, n) => {
    app.draft = { ...draft, [p]: Math.max(0, Math.min(9, n)) };
    renderSetup();
  };
  fill($('#counts'), ...PROFILE_ORDER.map((p) =>
    h('div', { class: 'count-row' },
      h('div', null, profileBadge(p), h('div', { class: 'muted small' }, PROFILES[p].desc)),
      h('div', { class: 'stepper' },
        h('button', { onclick: () => setCount(p, draft[p] - 1), 'aria-label': `Fewer ${PROFILES[p].label}` }, '−'),
        h('span', null, draft[p]),
        h('button', { onclick: () => setCount(p, draft[p] + 1), 'aria-label': `More ${PROFILES[p].label}` }, '+')))));
  const totalEl = $('#count-total');
  totalEl.textContent = `${total} / 9 seats`;
  totalEl.className = total === 9 ? 'muted' : 'error';
  $('#apply-counts').disabled = total !== 9;

  const nodes = [h('div', { class: 'felt-center' }, h('div', { class: 'pot-label' }, 'Seat layout'))];
  for (let seat = 0; seat < 9; seat++) {
    const [x, y] = seatXY(seat, 43, 40);
    nodes.push(h('div', { class: `seat setup prof-${app.table[seat]}`, style: `left:${x}%;top:${y}%` },
      h('div', { class: 'seat-top' }, h('span', { class: 'seat-pos' }, `Seat ${seat + 1}`)),
      h('select', { 'aria-label': `Seat ${seat + 1} profile`, onchange: (e) => {
        app.table[seat] = e.target.value;
        app.draft = null;
        saveTable();
        renderSetup();
      } }, PROFILE_ORDER.map((p) => h('option', { value: p, selected: app.table[seat] === p }, PROFILES[p].label)))));
  }
  fill($('#setup-felt'), ...nodes);
}

function applyCounts() {
  const draft = app.draft || countsOf(app.table);
  app.table = shuffled(PROFILE_ORDER.flatMap((p) => Array(draft[p]).fill(p)));
  app.draft = null;
  saveTable();
  renderSetup();
}

// ---- keyboard ------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (app.screen !== 'train' || !app.hand) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (!app.ctx) {
    if (k === 'enter' || k === 'n' || k === ' ') {
      e.preventDefault();
      nextHand();
    }
    return;
  }
  if (k === 'f' && !app.ctx.checkOption) heroAct('fold');
  else if (k === 'c' || k === 'k') heroAct('call');
  else if (k === 'r' && app.ctx.canRaise) {
    e.preventDefault();
    $('#raise-input').focus();
  }
});

// ---- boot ------------------------------------------------------------------------------

async function boot() {
  for (const b of document.querySelectorAll('nav.tabs button')) b.addEventListener('click', () => showScreen(b.dataset.screen));
  $('#apply-counts').addEventListener('click', applyCounts);
  $('#shuffle-seats').addEventListener('click', () => {
    app.table = shuffled(app.table);
    saveTable();
    renderSetup();
  });
  $('#start').addEventListener('click', () => {
    saveTable();
    showScreen('train');
  });

  try {
    const res = await fetch('data/ranges.csv', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadRanges(await res.text());
  } catch (err) {
    const el = $('#load-error');
    el.textContent = `Could not load data/ranges.csv (${err.message}). If you opened index.html directly from disk, serve the folder instead: npm start.`;
    el.hidden = false;
    return;
  }

  const stored = loadTable();
  app.table = stored || DEFAULT_TABLE.slice();
  renderStats();
  const fromHash = location.hash.slice(1);
  showScreen(['train', 'ranges', 'setup'].includes(fromHash) ? fromHash : stored ? 'train' : 'setup');
}

boot();
