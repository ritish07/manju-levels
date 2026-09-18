# Profitable Levels Strategy

## Status and scope

This document freezes the best-performing rules found in the one-year research run for NIFTY, BANKNIFTY, and SENSEX. It is a paper-trading/backtest specification, not a promise of future profitability. The rules must be forward-tested unchanged before any live deployment.

## Shared calculation and execution rules

### Option-premium levels

For each selected option contract, let `O` be the contract's first 09:15 one-minute candle open. This opening value remains fixed for the entire session, regardless of the chart timeframe.

```text
B = 2 * sqrt(O)
Upper level(m) = O + (m * B)
Lower level(m) = O - (m * B)
```

The level multipliers advance in increments of `0.75`:

```text
0.75, 1.50, 2.25, 3.00, 3.75, 4.50, ...
```

Examples: upper `0.75` is the first resistance above the option open; lower `1.50` is two level-steps below the option open.

### Contract selection and trade handling

- Use the nearest-expiry option and continuously determine the contract that is two strikes ITM from the current underlying price.
- A change in the two-strikes-ITM contract creates a new eligible contract, but each index is still limited to one completed entry per trading day under the frozen rules below.
- Use one lot per trade. The tested lot sizes were NIFTY `65`, BANKNIFTY `30`, and SENSEX `20`.
- A level is triggered when a one-minute candle's range touches or crosses it; a candle close at the level is not required unless a strategy-specific confirmation says otherwise.
- Enter at the specified theoretical level price. No chasing beyond the entry level is modeled.
- If both the stop and target are inside the same one-minute candle, record the stop first. This is the conservative intrabar assumption.
- If neither exit is reached, close the position at 15:15 using the available one-minute price.
- Charge `₹40` per completed trade, including the assumed brokerage, STT, and taxes.
- Do not add slippage in the reported test. Live and paper-forward evaluation should separately measure slippage.

## Exact strategy rules

### 1. SENSEX — VWAP-filtered continuation

1. Track the rolling two-strikes-ITM CE and PE contracts.
2. Permit a CE trade only while the SENSEX spot price is above the session VWAP.
3. Permit a PE trade only while the SENSEX spot price is below the session VWAP.
4. Enter the first eligible contract whose premium touches its upper `0.75` level.
5. Entry price: upper `0.75`.
6. Stop-loss: the option opening price, multiplier `0.00`.
7. Take-profit: upper `3.75`.
8. Exit the full quantity at the stop, target, or 15:15.
9. Maximum: one SENSEX trade per day.

### 2. NIFTY — VWAP-filtered, premium-banded continuation

1. Track the rolling two-strikes-ITM CE and PE contracts.
2. Permit a CE trade only while NIFTY spot is above the session VWAP.
3. Permit a PE trade only while NIFTY spot is below the session VWAP.
4. The option premium at the signal must be between `₹80` and `₹250`, inclusive.
5. Enter when the first eligible premium touches its upper `0.75` level.
6. Entry price: upper `0.75`.
7. Stop-loss: lower `1.50`—three `0.75` steps below the entry.
8. Take-profit: upper `3.00`—three `0.75` steps above the entry.
9. Exit the full quantity at the stop, target, or 15:15.
10. Maximum: one NIFTY trade per day.

### 3. BANKNIFTY — opening-direction breakout with partial profit

1. Track the rolling two-strikes-ITM CE and PE contracts.
2. Permit a CE trade only while BANKNIFTY spot is above its session opening price.
3. Permit a PE trade only while BANKNIFTY spot is below its session opening price.
4. The option's signal candle must close above the preceding option candle's high.
5. Enter when the first eligible premium touches its upper `2.25` level.
6. Entry price: upper `2.25`.
7. Initial stop-loss: the option opening price, multiplier `0.00`—three `0.75` steps below entry.
8. Book 50% of the quantity at upper `3.00`.
9. After the first target fills, move the stop on the remaining 50% to the entry price.
10. Exit the remaining 50% at upper `4.50`, the adjusted stop, or 15:15.
11. Maximum: one BANKNIFTY trade per day.

## One-year backtest report

### Test setup

- Test period: **4 September 2025 through 3 September 2026**.
- Source: Dhan one-minute historical/expired-option data with rolling two-strikes-ITM selection.
- Starting portfolio capital: **₹1,50,000** shared across all three indices.
- Position sizing: one lot per trade.
- Trading cost: **₹40 per completed trade**.
- No qualifying trade was rejected because of insufficient shared capital in this run.

### Combined result

| Metric | Result |
|---|---:|
| Starting capital | ₹1,50,000.00 |
| Ending capital | ₹3,90,320.40 |
| Net profit after costs | **₹2,40,320.40** |
| Return on starting capital | **160.21%** |
| Gross profit before assumed costs | ₹2,61,480.40 |
| Completed trades | 529 |
| Winning trades | 317 |
| Win rate | 59.92% |
| Profit factor | 1.58 |
| Maximum drawdown | ₹24,916.30 |
| Maximum drawdown from equity peak | 7.01% |
| Total assumed charges | ₹21,160.00 |

### Results by index

| Index | Trades | Win rate | Profit factor | Net profit |
|---|---:|---:|---:|---:|
| SENSEX | 180 | 43.33% | 2.69 | ₹1,15,960.94 |
| NIFTY | 159 | 55.35% | 1.23 | ₹52,562.84 |
| BANKNIFTY | 190 | 79.47% | 1.64 | ₹71,796.62 |
| **Combined** | **529** | **59.92%** | **1.58** | **₹2,40,320.40** |

Directional contribution:

| Index | CE net profit | PE net profit |
|---|---:|---:|
| SENSEX | ₹46,980.68 | ₹68,980.26 |
| NIFTY | ₹38,119.44 | ₹14,443.40 |
| BANKNIFTY | ₹34,618.55 | ₹37,178.07 |

### Monthly portfolio result

| Month | Net P&L |
|---|---:|
| 2025-09 | ₹8,087.94 |
| 2025-10 | ₹8,375.70 |
| 2025-11 | ₹2,575.76 |
| 2025-12 | ₹23,565.25 |
| 2026-01 | ₹15,043.62 |
| 2026-02 | ₹33,374.09 |
| 2026-03 | ₹24,545.94 |
| 2026-04 | ₹63,337.64 |
| 2026-05 | ₹14,258.79 |
| 2026-06 | ₹6,895.33 |
| 2026-07 | ₹40,022.45 |
| 2026-08 | ₹6,072.52 |
| 2026-09 (three sessions) | -₹5,834.65 |

## Selection and validation

For each index, 105 rule combinations were compared. Variants changed the entry level, stop distance, full target, and partial-profit target. The first 70% of the chronology—through 20 May 2026—was used to rank the variants. The final 30% was then used as an untouched chronological validation period.

| Index | Development trades | Development net | Development PF | Validation trades | Validation net | Validation PF |
|---|---:|---:|---:|---:|---:|---:|
| SENSEX | 111 | ₹86,675.33 | 3.09 | 69 | ₹29,285.61 | 2.07 |
| NIFTY | 90 | ₹39,732.73 | 1.31 | 69 | ₹12,830.10 | 1.13 |
| BANKNIFTY | 130 | ₹60,163.28 | 1.90 | 60 | ₹11,633.34 | 1.26 |

All three selected variants remained profitable in the untouched validation segment. That improves confidence, but it does not eliminate overfitting because many variants were evaluated.

## Important limitations

- The results use one-minute OHLC data, so the exact order of prices inside a candle is unknown. The stop-first rule reduces, but cannot remove, this uncertainty.
- Entries and exits are filled exactly at their calculated levels. Real fills can be worse because of spread, slippage, latency, and fast markets.
- The `₹40` cost is a flat assumption rather than an exact reconstruction of every historical tax and fee component.
- Current configured lot sizes were used across the dataset; historical exchange lot-size changes can alter capital usage and P&L.
- Rolling strike selection depends on the available underlying and option timestamps. Missing or delayed quotes can change the chosen contract.
- Backtest profitability is not evidence of guaranteed live profitability. Freeze these rules, run them in paper-forward mode, and compare signal time, expected fill, actual simulated fill, slippage, and rejected orders before considering real capital.

