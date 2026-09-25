import {NativeLanes, NativeNetworkApplicationRuntime} from "@chainsafe/lodestar-z/network";
import {RegistryMetricCreator} from "../../../metrics/utils/registryMetricCreator.js";

/** The bits of `pendingLanes`: the native drain calls that have work. */
export const nativeLanes: NativeLanes = {
  settle: 1,
  peers: 2,
  incoming: 4,
  gossipChecks: 8,
  gossipUrgent: 16,
  gossipOrdinary: 32,
};

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

/** Gossip bounds of one drain, with the `pendingLanes` bits read at its start. */
export type NativeGossipDrainLimits = {items: number; bytes: number; deadline: number; lanes: number};

/** Host consumers of the native lanes. Each returns whether it left work. */
export type NativeDrainStages = {
  peers(limit: number): boolean;
  requests(limit: number): boolean;
  /** Called on every drain: it may hold claimed jobs whatever the native lanes report. */
  gossip(limits: NativeGossipDrainLimits): boolean;
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
  };
}

/**
 * Delivers native results and lane work to the host in bounded macrotasks. `request` only schedules; each drain
 * reads which native lanes have work, settles results, then consumes peers, serving starts and gossip until a cap or
 * the time budget, and yields the rest to another macrotask. Native calls for lanes without work are skipped. Only a
 * drain that leaves nothing calls `endDrain`, which releases native's notification latch. After the host closes,
 * drains only settle, until native reports nothing left.
 */
export class NativeDrain {
  private scheduled = false;
  private notifiedAt: number | undefined;
  private readonly metrics: NativeDrainMetrics | null;

  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "pendingLanes" | "settle" | "endDrain">,
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
    if (this.notifiedAt !== undefined) this.metrics?.notifyToDrain.observe((started - this.notifiedAt) / 1000);
    this.notifiedAt = undefined;
    const {budgetMs, settle, peers, servingStarts, gossipItems, gossipBytes} = this.limits;
    const deadline = started + budgetMs;
    let more = false;
    try {
      const lanes = this.runtime.pendingLanes();
      if (lanes & nativeLanes.settle) more = this.runtime.settle(settle);
      const stages = this.stages();
      if (stages) {
        if (lanes & nativeLanes.peers) more = stages.peers(peers) || more;
        if (lanes & nativeLanes.incoming)
          more = performance.now() >= deadline || stages.requests(servingStarts) || more;
        // Gossip applies the budget to ordinary work only.
        more = stages.gossip({items: gossipItems, bytes: gossipBytes, deadline, lanes}) || more;
      }
    } catch (error) {
      more = this.onError(error);
    }
    let reason: "budget" | "caps" | "idle" = !more ? "idle" : performance.now() >= deadline ? "budget" : "caps";
    if (!more) {
      try {
        more = this.runtime.endDrain();
      } catch (error) {
        more = this.onError(error);
      }
      if (more) reason = "caps";
    }
    this.metrics?.duration.observe((performance.now() - started) / 1000);
    this.metrics?.yields.inc({reason});
    if (more) this.schedule();
  };
}
