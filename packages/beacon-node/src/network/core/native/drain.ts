import {
  NativeAction,
  NativeEscalation,
  NativeExchange,
  NativeExchangeDelivery,
  NativeExchangeDemand,
  NativeGossipDependencyCheck,
  NativeGossipHandle,
  NativeGossipJob,
  NativeGossipMessage,
  NativeGossipVerdict,
  NativeIncomingRequest,
  NativeNetworkApplicationRuntime,
  NativePeerAction,
  NativePeerObservation,
} from "@chainsafe/lodestar-z/network";
import {RegistryMetricCreator} from "../../../metrics/utils/registryMetricCreator.js";

/** Actions one exchange applies; native refuses a longer batch. */
export const ACTION_MAX = 256;
/** Imported roots coalesced between exchanges; more become one recheck of every waiting message. */
const BLOCK_MAX = 256;
/** Coalesced peer penalty entries, each saturating as native does; more are dropped and counted. */
const REPORT_ENTRY_MAX = 512;
const REPORT_COUNT_MAX = 100;
const RETRY_MS = 25;
/** Consecutive failures that escalate a broken bridge contract. */
const FAILURES_MAX = 3;

/** Per-turn bounds of the pump. */
export type NativeDrainLimits = {
  budgetMs: number;
  /** Completions settled per native table. */
  settle: number;
  peers: number;
  checks: number;
  servingStarts: number;
  gossipItems: number;
  gossipBytes: number;
};

/** A delivered job or serving start the pump owns until the host adopts it, by starting or holding its work. */
export class NativeClaim<T> {
  adopted = false;
  constructor(readonly item: T) {}
  adopt(): void {
    this.adopted = true;
  }
}

export type NativeJob = Omit<NativeGossipJob, "start" | "length"> & {messages: NativeGossipMessage[]};

/** One exchange's payload, with jobs and serving starts to adopt. */
export type NativeDelivery = {
  peers: readonly NativePeerObservation[];
  checks: readonly NativeGossipDependencyCheck[];
  starts: NativeClaim<NativeIncomingRequest>[];
  jobs: NativeClaim<NativeJob>[];
};

/** Host consumers of one exchange. */
export type NativeDrainStages = {
  /** Quotas past settlement and the host's standing capacities; `deadline` ends the turn's time budget. */
  demand(deadline: number): Omit<NativeExchangeDemand, "settleCells">;
  /** Hands a delivery to its consumers. Returns whether JS-held ordinary jobs remain. */
  deliver(delivery: NativeDelivery, deadline: number): boolean;
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

/** Now; after the retry timer, also for queued actions unless the exchange failed ("retry"); or on request. */
type Next = "now" | "later" | "retry" | "idle";

/** Settlement only: every payload quota zero and the capacities unchanged. */
const CONTROL = {
  bytes: 0,
  capacity: null,
  checks: 0,
  claimOrdinary: false,
  messages: 0,
  peers: 0,
  servingStarts: 0,
} satisfies Omit<NativeExchangeDemand, "settleCells">;

/**
 * Runs native exchanges in bounded macrotasks, each with queued obligations first, then coalesced requests, and hands
 * the delivery to the host. It runs again at once while native reports more, actions or JS-held jobs remain, or the
 * time budget left ordinary work, and after the one retry timer while work waits for external capacity or a disabled
 * service. After the host closes, turns only settle, until closed. A rollback runs a control-only recovery turn, then
 * a normal one. A broken bridge contract escalates through native `fail`, which terminates the process.
 */
export class NativeDrain {
  private scheduled = false;
  private running = false;
  private stopped = false;
  private retry: NodeJS.Timeout | undefined;
  private recovering = false;
  private notifiedAt: number | undefined;
  /** Consecutive turns whose demand threw or whose exchange could not run. */
  private turnFailures = 0;
  /** Consecutive rolled-back deliveries that retired nothing. */
  private failedDeliveries = 0;
  private readonly obligations: NativeAction[] = [];
  private readonly blocks = new Map<string, Uint8Array>();
  private recheck = false;
  private dropping = false;
  private readonly reports = new Map<string, {peerId: string; action: NativePeerAction; count: number}>();
  /** Peer penalties dropped because the coalescing table was full. */
  reportsDropped = 0;
  private readonly metrics: NativeDrainMetrics | null;

  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "exchange" | "fail" | "closed">,
    private readonly limits: NativeDrainLimits,
    private readonly stages: () => NativeDrainStages | null,
    private readonly onError: (error: unknown) => void,
    register: RegistryMetricCreator | null
  ) {
    this.metrics = register ? createNativeDrainMetrics(register) : null;
    void runtime.closed.then(
      () => this.stop(),
      () => this.stop()
    );
  }

  /** A native notification, or capacity the host released. */
  readonly request = (): void => {
    this.notifiedAt ??= performance.now();
    this.schedule();
  };

  /** One per delivered message. */
  verdict(handle: NativeGossipHandle, verdict: NativeGossipVerdict): void {
    this.obligations.push({handle, type: "verdict", verdict});
    this.schedule();
  }
  /** One per delivered dependency check. */
  classify(handle: NativeGossipHandle, available: boolean): void {
    this.obligations.push({available, handle, type: "classify"});
    this.schedule();
  }
  block(root: Uint8Array): void {
    if (this.recheck) return;
    const key = Buffer.from(root).toString("hex");
    if (!this.blocks.has(key) && this.blocks.size >= BLOCK_MAX) {
      this.blocks.clear();
      this.recheck = true;
    } else this.blocks.set(key, root);
    this.schedule();
  }
  dropQueued(): void {
    this.dropping = true;
    this.schedule();
  }
  reportPeer(peerId: string, action: NativePeerAction): void {
    const key = `${action}:${peerId}`;
    const report = this.reports.get(key);
    if (report) report.count = Math.min(REPORT_COUNT_MAX, report.count + 1);
    else if (this.reports.size >= REPORT_ENTRY_MAX) this.reportsDropped++;
    else this.reports.set(key, {action, count: 1, peerId});
    this.schedule();
  }

  private pending(): boolean {
    return (
      this.obligations.length > 0 || this.blocks.size > 0 || this.recheck || this.dropping || this.reports.size > 0
    );
  }

  /** Up to `ACTION_MAX` queued actions; `commit` removes them once native applied them. */
  private batch(): {actions: NativeAction[]; commit(): void} {
    const actions = this.obligations.slice(0, ACTION_MAX);
    const obligations = actions.length;
    const blocks: string[] = [];
    const reports: string[] = [];
    for (const [key, root] of this.blocks) {
      if (actions.length === ACTION_MAX) break;
      actions.push({root, type: "block"});
      blocks.push(key);
    }
    const recheck = this.recheck && actions.length < ACTION_MAX;
    if (recheck) actions.push({type: "recheck"});
    const dropping = this.dropping && actions.length < ACTION_MAX;
    if (dropping) actions.push({type: "dropQueued"});
    for (const [key, {peerId, action, count}] of this.reports) {
      if (actions.length === ACTION_MAX) break;
      actions.push({action, count, peerId, type: "reportPeer"});
      reports.push(key);
    }
    return {
      actions,
      commit: () => {
        this.obligations.splice(0, obligations);
        for (const key of blocks) this.blocks.delete(key);
        if (recheck) this.recheck = false;
        if (dropping) this.dropping = false;
        for (const key of reports) this.reports.delete(key);
      },
    };
  }

  private schedule(): void {
    if (this.scheduled || this.running || this.stopped) return;
    this.scheduled = true;
    setImmediate(this.run);
  }

  private retryLater(): void {
    if (this.retry || this.stopped) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.schedule();
    }, RETRY_MS);
    this.retry.unref();
  }

  private stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
  }

  private escalate(trigger: NativeEscalation, cause: unknown): never {
    this.stop();
    const reason = typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "unknown";
    this.runtime.fail(trigger, reason.replace(/[^\x20-\x7e]/g, "?").slice(0, 64));
    throw Error("Native escalation returned");
  }

  private readonly run = (): void => {
    this.scheduled = false;
    if (this.stopped) return;
    const started = performance.now();
    const notifiedAt = this.notifiedAt;
    this.notifiedAt = undefined;
    this.running = true;
    // A turn that throws in host code runs again, since native may hold more.
    let next: Next = "now";
    try {
      next = this.turn(started + this.limits.budgetMs);
    } finally {
      this.running = false;
      // The burst end is queued first, so it covers only this turn.
      if (this.metrics) setImmediate(this.burstEnd, started);
      // Actions queued while the turn ran need one too, unless its exchange failed.
      if (next === "now" || (next !== "retry" && this.pending())) this.schedule();
      else if (next !== "idle") this.retryLater();
    }
    const budget = performance.now() >= started + this.limits.budgetMs;
    if (notifiedAt !== undefined) this.metrics?.notifyToDrain.observe((started - notifiedAt) / 1000);
    this.metrics?.duration.observe((performance.now() - started) / 1000);
    this.metrics?.yields.inc({reason: next !== "now" ? "idle" : budget ? "budget" : "caps"});
  };

  private turn(deadline: number): Next {
    const stages = this.recovering ? null : this.stages();
    const recovery = this.recovering;
    this.recovering = false;
    let demand: NativeExchangeDemand = {...CONTROL, settleCells: this.limits.settle};
    let normal = false;
    if (stages) {
      try {
        demand = {...stages.demand(deadline), settleCells: this.limits.settle};
        normal = true;
      } catch (error) {
        if (++this.turnFailures >= FAILURES_MAX) this.escalate(3, error);
        this.onError(error);
      }
    }
    const {actions, commit} = this.batch();
    let result: NativeExchange;
    try {
      result = this.runtime.exchange(actions, demand);
    } catch (error) {
      // Native refuses only an invalid batch or a nested exchange, so a refusal of this generated batch is a
      // broken contract. Anything else leaves native state untouched and retries.
      const code = (error as {code?: unknown} | null)?.code;
      if (typeof code === "string") this.escalate(1, code);
      if (++this.turnFailures >= FAILURES_MAX) this.escalate(3, error);
      this.onError(error);
      return "retry";
    }
    commit();
    if (normal) this.turnFailures = 0;
    if (result.rolledBack) {
      if (result.retired) this.failedDeliveries = 0;
      else if (++this.failedDeliveries >= FAILURES_MAX) this.escalate(4, "delivery rolled back");
      // Control completions get a turn that does not depend on building payload.
      this.recovering = true;
      return "now";
    }
    if (result.retired || delivers(result)) this.failedDeliveries = 0;
    let held = false;
    let failure: unknown = result.failure;
    try {
      if (stages && normal) held = this.deliver(stages, result, deadline);
    } catch (error) {
      failure ??= error;
    }
    // A recovery turn is followed by a normal one whatever it reports. Ordinary work the time budget left unclaimed
    // waits for the next turn, as held jobs do.
    const budgetEnded = normal && demand.messages > 0 && !demand.claimOrdinary;
    let next: Next = "idle";
    if (recovery || result.more || held || (budgetEnded && result.disabledWaiting)) next = "now";
    else if (result.parked.serving || result.parked.ordinary || result.disabledWaiting) next = "later";
    if (failure !== null) this.onError(failure);
    return next;
  }

  /**
   * Hands the delivery to the host. Whatever the host throws, the pump keeps what it never adopted: a job gets an
   * ignore verdict, and a serving start is cancelled, which releases it.
   */
  private deliver(stages: NativeDrainStages, result: NativeExchangeDelivery, deadline: number): boolean {
    const gossip = result.gossip;
    const jobs = (gossip?.jobs ?? []).map(
      ({kind, grouped, urgent, start, length}) =>
        new NativeClaim<NativeJob>({
          grouped,
          kind,
          messages: gossip?.messages.slice(start, start + length) ?? [],
          urgent,
        })
    );
    const starts = result.serving.map((request) => new NativeClaim(request));
    try {
      return stages.deliver({checks: result.checks, jobs, peers: result.peers, starts}, deadline);
    } finally {
      for (const job of jobs)
        if (!job.adopted) for (const {handle} of job.item.messages) this.verdict(handle, "ignore");
      for (const start of starts) if (!start.adopted) void start.item.cancel().catch(() => {});
    }
  }

  private readonly burstEnd = (started: number): void => {
    this.metrics?.burst.observe((performance.now() - started) / 1000);
  };
}

function delivers(result: NativeExchangeDelivery): boolean {
  return (
    result.peers.length > 0 ||
    result.serving.length > 0 ||
    result.checks.length > 0 ||
    (result.gossip?.messages.length ?? 0) > 0
  );
}
