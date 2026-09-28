# Preflop Trainer — $1/$2 NLHE

A static, no-build web app for drilling preflop decisions and raise sizing in a 9-handed $1/$2 live cash game ($200 stacks), plus a postflop equity and EV-0 calculator.

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

On the **Pre-Flop** tab, keyboard: `F` fold, `C` call/check, `R` jump to the raise box (Enter submits), `Enter` next hand.

## Equity checker

The **Equity** tab computes your equity against a known hand or a range, preflop or on any street. Postflop, every remaining turn/river card is enumerated exactly. Preflop (empty board) is exact against a single hand (all 1,712,304 boards) and simulated against a range (~600k random boards, shown with its ±95% margin):

1. **Your hand** — click your two cards in the 52-card picker.
2. **Board** — leave empty for preflop, or click 3, 4 or 5 cards (flop, turn, river).
3. **Villain** — either *Exact hand* (two cards from the same card picker) or *Range*: drag across the matrix to paint hands, or load any chart from `data/ranges.csv` (raise + call, raise only, or call only). Combos blocked by known cards are removed.
4. **Pot & bet** — pot before the betting (default 50bb = $100), your bet already in (if you're facing a raise), and villain's bet/raise-to. The **bb / $** toggle switches inputs and results between big blinds and dollars (1bb = $2).

Press **Compute equity**. The result shows win/tie/lose, your equity against each hand in the range (heat map), and the EV-0 threshold: the largest bet (or raise-to) you can call on pure equity. With equity `E`, pot `P`, your bet `h` and villain's bet/raise-to `R`:

- calling costs `R − h` to win a final pot of `P + 2R`, so the required equity is `(R − h) / (P + 2R)`
- EV of calling = `E·(P + 2R) − (R − h)`
- break-even size `R* = (E·P + h) / (1 − 2E)`; at `E ≥ 50%` every call is +EV
- **EV-neutral bet (if you bet first):** villain calls `B` to win `P + 2B` with equity `1 − E`, so their call breaks even at `B* = (1 − E)·P / (2E − 1)`. Bet more than `B*` and calling is a mistake for them; at `E ≤ 50%` there is no value bet (check).

These treat the bet or call as the last money in — no implied odds, future betting or fold equity.

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
