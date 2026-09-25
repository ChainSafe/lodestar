import {
  NativeAction,
  NativeEscalation,
  NativeExchange,
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
/** Consecutive failed turns, each counted once for a failed demand or exchange, before escalating. */
const FAILURES_MAX = 3;

/** Per-turn bounds of the pump: its time budget and the completions settled per native table. */
export type NativeDrainLimits = {budgetMs: number; settle: number};

/** A delivered job or serving start the pump owns until the host adopts it, by starting or holding its work. */
export class NativeClaim<T> {
  adopted = false;
  constructor(readonly item: T) {}
  adopt(): void {
    this.adopted = true;
  }
}

/** A claimed job, with when the exchange that claimed it started, on the performance clock. */
export type NativeJob = Omit<NativeGossipJob, "start" | "length"> & {
  messages: NativeGossipMessage[];
  exchangedAt: number;
};

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

type Coalesced = Exclude<NativeAction, {type: "verdict" | "classify"}>;

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
 * service, or after a failed demand. After the host closes, turns only settle, until closed. A broken bridge contract
 * escalates through native `fail`, which terminates the process.
 */
export class NativeDrain {
  private scheduled = false;
  private running = false;
  private stopped = false;
  private retry: NodeJS.Timeout | undefined;
  private notifiedAt: number | undefined;
  /** Consecutive turns whose demand threw or whose exchange could not run. */
  private failures = 0;
  private readonly obligations: NativeAction[] = [];
  /** Queued verdicts' callbacks for the start of the exchange that applies them. */
  private readonly sent = new Map<NativeAction, (at: number) => void>();
  /** One entry per imported root, per penalized peer and action, and for a recheck or a drop, in arrival order. */
  private readonly coalesced = new Map<string, Coalesced>();
  private blocks = 0;
  private reports = 0;
  /** Peer penalties dropped because the coalescing table was full. */
  reportsDropped = 0;
  private readonly metrics: NativeDrainMetrics | null;

  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "exchange" | "fail" | "closed">,
    private readonly limits: NativeDrainLimits,
    private readonly stages: () => NativeDrainStages | null,
    /** A failure the pump recovers from: a demand that threw or an exchange that did not run. */
    private readonly onError: (error: unknown) => void,
    /** A host handler or facade failure after a delivery. */
    private readonly onFailure: (error: unknown) => void,
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

  /** One per delivered message. `sent` hears when the exchange that applies it starts. */
  verdict(handle: NativeGossipHandle, verdict: NativeGossipVerdict, sent?: (at: number) => void): void {
    const action: NativeAction = {handle, type: "verdict", verdict};
    this.obligations.push(action);
    if (sent) this.sent.set(action, sent);
    this.schedule();
  }
  /** One per delivered dependency check. */
  classify(handle: NativeGossipHandle, available: boolean): void {
    this.obligations.push({available, handle, type: "classify"});
    this.schedule();
  }
  block(root: Uint8Array): void {
    this.coalesce({root, type: "block"});
  }
  dropQueued(): void {
    this.coalesce({type: "dropQueued"});
  }
  reportPeer(peerId: string, action: NativePeerAction): void {
    this.coalesce({action, count: 1, peerId, type: "reportPeer"});
  }

  private coalesce(action: Coalesced): void {
    this.add(action);
    this.schedule();
  }

  /** Queues a coalesced request, merging a penalty into its entry, within the ledger's bounds. */
  private add(action: Coalesced): void {
    const key = keyOf(action);
    const queued = this.coalesced.get(key);
    if (queued) {
      if (queued.type === "reportPeer" && action.type === "reportPeer")
        queued.count = Math.min(REPORT_COUNT_MAX, queued.count + action.count);
      return;
    }
    if (action.type === "block") {
      if (this.coalesced.has("recheck")) return;
      if (this.blocks === BLOCK_MAX) {
        for (const [queuedKey, {type}] of this.coalesced) if (type === "block") this.coalesced.delete(queuedKey);
        this.blocks = 0;
        this.coalesced.set("recheck", {type: "recheck"});
        return;
      }
      this.blocks++;
    } else if (action.type === "reportPeer") {
      if (this.reports === REPORT_ENTRY_MAX) {
        this.reportsDropped++;
        return;
      }
      this.reports++;
    }
    // A penalty is copied, so an entry in flight never changes.
    this.coalesced.set(key, action.type === "reportPeer" ? {...action} : action);
  }

  /** Moves up to `ACTION_MAX` queued actions into one batch; what arrives meanwhile queues for the next one. */
  private take(): NativeAction[] {
    const batch = this.obligations.splice(0, ACTION_MAX);
    for (const [key, action] of this.coalesced) {
      if (batch.length === ACTION_MAX) break;
      this.coalesced.delete(key);
      if (action.type === "block") this.blocks--;
      else if (action.type === "reportPeer") this.reports--;
      batch.push(action);
    }
    return batch;
  }

  /** Returns a batch native never applied to the ledger. */
  private requeue(batch: NativeAction[]): void {
    this.obligations.unshift(...batch.filter(({type}) => type === "verdict" || type === "classify"));
    for (const action of batch) if (action.type !== "verdict" && action.type !== "classify") this.add(action);
  }

  private pending(): boolean {
    return this.obligations.length > 0 || this.coalesced.size > 0;
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
    const stages = this.stages();
    let demand: NativeExchangeDemand = {...CONTROL, settleCells: this.limits.settle};
    let failed = false;
    if (stages) {
      try {
        demand = {...stages.demand(deadline), settleCells: this.limits.settle};
      } catch (error) {
        // The turn still settles control; the demand retries on the timer.
        if (++this.failures >= FAILURES_MAX) this.escalate(3, error);
        failed = true;
        this.onError(error);
      }
    }
    const batch = this.take();
    const exchangedAt = performance.now();
    let result: NativeExchange;
    try {
      result = this.runtime.exchange(batch, demand);
    } catch (error) {
      // Native refuses only an invalid batch or a nested exchange, so a refusal of this generated batch is a
      // broken contract. Anything else left native untouched: the batch requeues and the turn retries.
      const code = (error as {code?: unknown} | null)?.code;
      if (typeof code === "string") this.escalate(1, code);
      this.requeue(batch);
      // A turn whose demand failed has counted already.
      if (!failed && ++this.failures >= FAILURES_MAX) this.escalate(3, error);
      this.onError(error);
      return "retry";
    }
    // Any exchange that ran without a failed demand ends the run, a settling one after close included.
    if (!failed) this.failures = 0;
    let held = false;
    let failure: unknown = result.failure;
    try {
      if (stages && !failed) held = this.deliver(stages, result, deadline, exchangedAt);
    } catch (error) {
      failure ??= error;
    }
    // Ordinary work the time budget left unclaimed waits for the next turn, as held jobs do.
    const budgetEnded = stages !== null && !failed && demand.messages > 0 && !demand.claimOrdinary;
    let next: Next = "idle";
    if (result.more || held || (budgetEnded && result.disabledWaiting)) next = "now";
    else if (failed || result.parked.serving || result.parked.ordinary || result.disabledWaiting) next = "later";
    if (failure !== null) this.onFailure(failure);
    // Last, so a throwing observer cannot cost a delivery its adoption or ignore verdicts.
    if (this.sent.size > 0)
      for (const action of batch) {
        const sent = this.sent.get(action);
        if (!sent) continue;
        this.sent.delete(action);
        sent(exchangedAt);
      }
    return next;
  }

  /**
   * Hands the delivery to the host. Whatever the host throws, the pump keeps what it never adopted: a job gets an
   * ignore verdict, and a serving start is cancelled, which releases it.
   */
  private deliver(stages: NativeDrainStages, result: NativeExchange, deadline: number, exchangedAt: number): boolean {
    const gossip = result.gossip;
    const jobs = (gossip?.jobs ?? []).map(
      ({kind, grouped, urgent, start, length}) =>
        new NativeClaim<NativeJob>({
          exchangedAt,
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

function keyOf(action: Coalesced): string {
  switch (action.type) {
    case "block":
      return `block:${Buffer.from(action.root).toString("hex")}`;
    case "reportPeer":
      return `report:${action.action}:${action.peerId}`;
    default:
      return action.type;
  }
}
