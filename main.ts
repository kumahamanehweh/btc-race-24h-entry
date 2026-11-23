// Two-scale burst rider for cbBTC (CBBTC/USDC) — agent-fun/bars-replay/v1.
//
// Dev window in one line: BTC rose in a single ~2h burst (+3.2%) then went
// sideways for 20h. Every fast/active strategy bleeds out to fees (a full-size
// round trip costs ~26 bps; 1-minute noise is ~8 bps), so this bot only rides
// a confirmed burst and otherwise sits in cash:
//   - enter (flat only): 30-bar return > +50 bps AND 120-bar return > 0 bps,
//     buying 100% of cash;
//   - exit (holding): trailing stop 2.5% below the peak position value.
// Pure function of closes: no randomness, no clock, no network, no files.
import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const FAST_BARS = 30;
const FAST_BPS = 50;
const SLOW_BARS = 120;
const SLOW_BPS = 0;
const TRAIL_PCT = 0.025;
const EXIT_SLOW_BPS = -150;
const COOLDOWN_BARS = 120;
const MAX_SLIPPAGE_BPS = 100;

const closes: number[] = [];
let peak = 0;
let lastExit = -1000000;

function retBps(now: number, back: number): number | null {
  const i = closes.length - 1;
  if (i < back) return null;
  const old = closes[i - back];
  if (old <= 0) return null;
  return (now / old - 1) * 10000;
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    closes.push(Number(bar.c));
    const close = Number(bar.c);
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;
    const rf = retBps(close, FAST_BARS);
    const rs = retBps(close, SLOW_BARS);
    if (rf === null || rs === null) return [];
    if (qty > 0n) {
      const val = Number(state.value(SYMBOL, qty));
      if (val > peak) peak = val;
      if (peak > 0 && val <= peak * (1 - TRAIL_PCT)) {
        lastExit = state.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (rs < EXIT_SLOW_BPS) {
        lastExit = state.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }
    if (state.seq - lastExit >= COOLDOWN_BARS && rf > FAST_BPS && rs > SLOW_BPS) {
      const room = state.weightRoom(SYMBOL);
      const spend = state.cash < room ? state.cash : room;
      if (spend <= 0n) return [];
      peak = 0;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
