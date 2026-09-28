// Small DOM helpers shared by the screens.
import { suitSymbol, isRed } from './cards.js';

export const $ = (sel) => document.querySelector(sel);

export function h(tag, attrs, ...children) {
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

export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

export function cardEl(card, cls = '') {
  return h('span', { class: `pcard ${isRed(card) ? 'red' : ''} ${cls}` }, card[0], h('span', { class: 'suit' }, suitSymbol(card)));
}
