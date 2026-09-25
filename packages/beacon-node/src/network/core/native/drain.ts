import {NativeExchange, NativeExchangeDemand, NativeNetworkApplicationRuntime} from "@chainsafe/lodestar-z/network";
import {RegistryMetricCreator} from "../../../metrics/utils/registryMetricCreator.js";

/** Per-macrotask bounds of the native drain. */
export type NativeDrainLimits = {
  budgetMs: number;
  peers: number;
  /** Completions settled per native table. */
  settle: number;
  servingStarts: number;
  gossipItems: number;
  gossipBytes: number;
};

/** Gossip bounds of one drain. */
export type NativeGossipDrainLimits = {items: number; bytes: number; deadline: number};

/** Host consumers of one exchange. */
export type NativeDrainStages = {
  /** Serving starts the host can take now, up to `max`. */
  serving(max: number): number;
  gossip(limits: NativeGossipDrainLimits): NativeExchangeDemand["gossip"];
  /** Hands the exchange's payload to its consumers. Returns whether host work remains. */
  deliver(result: NativeExchange, gossip: NativeExchangeDemand["gossip"], deadline: number): boolean;
};

type NativeDrainMetrics = ReturnType<typeof createNativeDrainMetrics>;

function createNativeDrainMetrics(register: RegistryMetricCreator) {
  const buckets = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2];
  return {
    duration: register.histogram({
      name: "lodestar_native_drain_seconds",
      help: "Duration of each native drain macrotask",
      buckets,
    }),
    yields: register.counter<{reason: "budget" | "caps" | "idle"}>({
      name: "lodestar_native_drain_yields_total",
      help: "Native drains that ended with work left by the time budget or a cap, or with none left",
      labelNames: ["reason"],
    }),
    notifyToDrain: register.histogram({
      name: "lodestar_native_notify_to_drain_seconds",
      help: "Delay from a native work notification to the start of the drain it scheduled",
      buckets,
    }),
    burst: register.histogram({
      name: "lodestar_native_drain_burst_seconds",
      help: "Time from a native drain macrotask's start to the next setImmediate checkpoint, including the promise continuations it triggered",
      buckets,
    }),
  };
}

/**
 * Delivers native results and work to the host in bounded macrotasks. `request` only schedules; each drain makes one
 * exchange, which settles results and delivers peers, serving starts and gossip within the drain's caps, and hands
 * them to the host, whose time budget holds ordinary jobs for another macrotask. An exchange with nothing more
 * releases native's notification latch. After the host closes, drains only settle, until native reports nothing left.
 */
export class NativeDrain {
  private scheduled = false;
  private notifiedAt: number | undefined;
  private readonly metrics: NativeDrainMetrics | null;

  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "exchange">,
    private readonly limits: NativeDrainLimits,
    private readonly stages: () => NativeDrainStages | null,
    /** Returns whether to drain again after a failure. */
    private readonly onError: (error: unknown) => boolean,
    register: RegistryMetricCreator | null
  ) {
    this.metrics = register ? createNativeDrainMetrics(register) : null;
  }

  readonly request = (): void => {
    this.notifiedAt ??= performance.now();
    this.schedule();
  };

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(this.run);
  }

  private readonly run = (): void => {
    this.scheduled = false;
    const started = performance.now();
    const notifiedAt = this.notifiedAt;
    this.notifiedAt = undefined;
    const {budgetMs, settle, peers, servingStarts, gossipItems, gossipBytes} = this.limits;
    const deadline = started + budgetMs;
    let more = false;
    try {
      try {
        const stages = this.stages();
        const gossip = stages?.gossip({items: gossipItems, bytes: gossipBytes, deadline}) ?? null;
        const serving = stages?.serving(servingStarts) ?? 0;
        const result = this.runtime.exchange({settle, peers: stages ? peers : 0, serving, gossip});
        more = result.more;
        if (stages) more = stages.deliver(result, gossip, deadline) || more;
        // A serving start the binding could not hand over was cancelled; everything else was delivered.
        if (result.failure !== null) throw result.failure;
      } catch (error) {
        if (this.onError(error)) more = true;
      }
    } finally {
      // Native keeps its latch while it reported more, so the next drain is scheduled whatever reporting throws.
      // The burst end is queued first, so it covers only this drain.
      if (this.metrics) setImmediate(this.burstEnd, started);
      if (more) this.schedule();
    }
    const reason = !more ? "idle" : performance.now() >= deadline ? "budget" : "caps";
    if (notifiedAt !== undefined) this.metrics?.notifyToDrain.observe((started - notifiedAt) / 1000);
    this.metrics?.duration.observe((performance.now() - started) / 1000);
    this.metrics?.yields.inc({reason});
  };

  private readonly burstEnd = (started: number): void => {
    this.metrics?.burst.observe((performance.now() - started) / 1000);
  };
}
