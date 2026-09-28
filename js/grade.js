// Grade the hero's decision against the pro chart, and a raise size against
// the sizing formula.

import { lookup, normalize } from './profiles.js';
import { targetRaise } from './sizing.js';

export const SIZE_TOLERANCE = 0.1; // within 10% of target counts as "close"

export function gradeDecision(ctx, key, action, raiseTo) {
  const chart = lookup('pro', ctx);
  const proActs = normalize(chart.map.get(key) || ['fold'], ctx);
  const res = {
    chart,
    proActs,
    correct: proActs.includes(action),
    mixed: proActs.length > 1,
    target: ctx.canRaise ? targetRaise(ctx) : null,
    sizing: null,
  };
  if (action === 'raise' && res.target) {
    const diff = raiseTo - res.target.to;
    const grade = Math.abs(diff) <= 1 ? 'exact' : Math.abs(diff) / res.target.to <= SIZE_TOLERANCE ? 'close' : 'off';
    res.sizing = { grade, diff, entered: raiseTo };
  }
  return res;
}
