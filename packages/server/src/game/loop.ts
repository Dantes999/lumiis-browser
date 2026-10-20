// Fixed-step loop.
//
// The world advances in whole ticks, never in "however much time passed".
// Wall-clock time is only used to decide how many ticks are due; the result is
// that a slow frame produces more ticks, not faster ticks.

import { MAX_CATCH_UP_TICKS } from '@lumiis/shared';

export class FixedStepLoop {
  private lastRunAt = 0;
  private executedTicks = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tickMs: number,
    private readonly onTick: (tick: number) => void,
    private readonly clock: () => number = () => performance.now(),
    private readonly maxCatchUpTicks: number = MAX_CATCH_UP_TICKS,
  ) {}

  get tick(): number {
    return this.executedTicks;
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastRunAt = this.clock();
    this.timer = setInterval(() => this.pump(), Math.max(1, Math.round(this.tickMs)));
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Runs every tick that is due and returns how many were executed.
   * Exposed for tests: no timers involved.
   */
  pump(): number {
    const now = this.clock();
    const elapsed = now - this.lastRunAt;
    if (elapsed < this.tickMs) return 0;

    const due = Math.floor(elapsed / this.tickMs);
    const run = Math.min(due, this.maxCatchUpTicks);

    if (due > run) {
      // Too far behind to catch up: drop the backlog instead of spiralling.
      this.lastRunAt = now;
    } else {
      this.lastRunAt += run * this.tickMs;
    }

    for (let i = 0; i < run; i += 1) {
      this.executedTicks += 1;
      this.onTick(this.executedTicks);
    }
    return run;
  }
}
