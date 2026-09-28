// Fixed raise-sizing formulas, in $ at $1/$2 (1bb = $2).
//   Open / iso  = 5bb + 1bb per limper
//   3-bet       = (4 + callers) x open size
//   4-bet       = (2.5 + 0.5 x callers) x 3-bet size
//   5-bet       = all-in

export const SB = 1;
export const BB = 2;
export const STACK = 200;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ctx comes from engine.getContext(). Returns the formula-correct "raise to" amount.
export function targetRaise(ctx) {
  let to;
  let formula;
  if (ctx.level === 1) {
    const bbs = 5 + ctx.limpers;
    to = bbs * BB;
    formula = ctx.limpers
      ? `Iso = 5bb + ${plural(ctx.limpers, 'limper')} × 1bb = ${bbs}bb = $${to}`
      : `Open = 5bb = $${to}`;
  } else if (ctx.level === 2) {
    to = (4 + ctx.callers) * ctx.lastRaiseTo;
    formula = `3-bet = (4 + ${plural(ctx.callers, 'caller')}) × $${ctx.lastRaiseTo} open = $${to}`;
  } else if (ctx.level === 3) {
    to = Math.round((2.5 + 0.5 * ctx.callers) * ctx.lastRaiseTo);
    formula = `4-bet = (2.5 + 0.5 × ${plural(ctx.callers, 'caller')}) × $${ctx.lastRaiseTo} 3-bet = $${to}`;
  } else {
    to = ctx.maxTo;
    formula = `5-bet = all-in ($${to})`;
  }
  const capped = to > ctx.maxTo;
  if (capped) {
    to = ctx.maxTo;
    formula += ` → capped at your stack: all-in $${to}`;
  }
  return { to: Math.max(to, ctx.minRaiseTo), formula, allIn: to >= ctx.maxTo };
}
