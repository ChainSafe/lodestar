import {Histogram} from "@lodestar/utils";

const PROBE_INTERVAL_MS = 10;
const BPS_PER_SLOT = 10_000;
const PHASE_BUCKETS = 16;
/** Each bucket is labeled by the first basis point of the slot it covers, as the native network's phase metrics are */
const PHASE_LABELS = Array.from({length: PHASE_BUCKETS}, (_, i) =>
  String((i * BPS_PER_SLOT) / PHASE_BUCKETS).padStart(4, "0")
);

/**
 * Probes event loop delay with a timer due every 10 ms, observing how late each probe ran in the slot phase bucket of the
 * time it was due, not the time it ran, so a long task is charged to the phase it started delaying.
 */
export class EventLoopDelayByPhase {
  private timeout: NodeJS.Timeout | null = null;
  /** The `performance.now()` time the pending probe is due */
  private due = 0;

  constructor(
    private readonly genesisMs: number,
    private readonly slotMs: number,
    private readonly histogram: Histogram<{phase_bps: string}>
  ) {
    this.schedule();
  }

  stop(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private schedule(): void {
    this.due = performance.now() + PROBE_INTERVAL_MS;
    this.timeout = setTimeout(this.probe, PROBE_INTERVAL_MS);
    this.timeout.unref();
  }

  private readonly probe = (): void => {
    // Timers run on the event loop's millisecond clock, so a probe can run up to 1 ms before `due`
    const delay = Math.max(0, performance.now() - this.due);
    const sinceGenesis = Date.now() - delay - this.genesisMs;
    if (sinceGenesis >= 0) {
      const bucket = Math.floor(((sinceGenesis % this.slotMs) * PHASE_BUCKETS) / this.slotMs);
      this.histogram.observe({phase_bps: PHASE_LABELS[bucket]}, delay / 1000);
    }
    this.schedule();
  };
}
