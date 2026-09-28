# Preflop Trainer — $1/$2 NLHE

A static, no-build web app for drilling preflop decisions and raise sizing in a 9-handed $1/$2 live cash game ($200 stacks).

- You sit in a random seat each hand; the other 8 seats are villains with fixed profiles you choose on **Table setup**: `casual` (limps/overlimps, calls wide), `omc` (only plays monsters), `pro` (GTO-ish) and `tilted` (too wide and aggressive).
- Villains act from the range charts in [`data/ranges.csv`](data/ranges.csv). The **Ranges** tab shows every chart as a 13×13 grid.
- Your fold / call / raise is graded against the **pro** chart for the same spot. Mixed cells accept either action.
- Raise amounts are typed as the dollar total you raise *to* and graded against the fixed formulas:

| Raise | Formula |
|---|---|
| Open / iso | 5bb + 1bb per limper |
| 3-bet | (4 + callers) × open size |
| 4-bet | (2.5 + 0.5 × callers) × 3-bet size |
| 5-bet | all-in |

"Exact" means within $1 of the formula; "close" means within 10%.

Keyboard: `F` fold, `C` call/check, `R` jump to the raise box (Enter submits), `Enter` next hand.

## Editing ranges

Each row of `data/ranges.csv` is one chart: `profile, spot, raise, call, raise_or_call, raise_or_fold, call_or_fold`. Hands in no column fold. Tokens are space-separated standard notation: `77+`, `55-22`, `A9s+`, `KTo+`, `A5s-A2s`, `AKo`, `AK`.

Spots, from most to least specific (the app uses the first one a profile defines):

| Situation | Specific spot ids | Generic |
|---|---|---|
| Folded to you | `rfi.UTG` … `rfi.SB` | `rfi` |
| Facing limpers | `limped.EP` / `MP` / `LP` / `SB` / `BB` | `limped` |
| Facing an open | `vsOpen.{IP,SB,BB}_{early,late}` (raiser UTG–LJ = early) | `vsOpen` |
| Facing 3-bet / 4-bet / all-in | `vs3bet.invested` / `vs3bet.cold` (same for `vs4bet`, `vsAllin`) | `vs3bet`, … |

A hand may appear in only one column per row; `npm test` checks this.

## Running locally

ES modules and `fetch` need a web server, not `file://`:

```sh
npm start        # http://localhost:8080
npm test         # engine + range checks, plain Node (no dependencies)
```

## Deploying

GitHub Pages serves the repo root directly — no build. In the repo's **Settings → Pages**, set Source to *Deploy from a branch*, branch `main`, folder `/ (root)`.
