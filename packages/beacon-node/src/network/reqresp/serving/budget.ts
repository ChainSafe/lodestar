import {defer} from "@lodestar/utils";
import {ServingCapacityError, ServingConfigurationError, ServingContext} from "../../../chain/serving/context.js";
import {ReqRespMethod} from "../types.js";
import {ServingPolicy, ServingWork} from "./policy.js";

export class ServingLease {
  readonly context: ServingContext;
  readonly retired: Promise<void>;
  private readonly resolveRetired: () => void;
  private pending = 0;
  private finished = false;
  private released = false;
  private retiring = false;
  working = false;
  retained = false;
  waiting: {kind: "retained" | "work"; completion: ReturnType<typeof defer<void>>} | undefined;

  constructor(
    readonly work: ServingWork,
    readonly peer: string,
    private readonly budget: HostServingBudget
  ) {
    const retired = defer<void>();
    this.retired = retired.promise;
    this.resolveRetired = retired.resolve;
    this.context = new ServingContext(work.limits, () => this.tryRelease());
  }
  track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.released || this.pending >= 2) throw new ServingConfigurationError("Serving operation cardinality");
    this.pending++;
    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      promise = Promise.reject(error);
    }
    return promise.finally(() => {
      this.pending--;
      this.tryRelease();
    });
  }
  async startWork(): Promise<void> {
    this.context.assertActive();
    if (!this.working) await this.budget.schedule(this, "work");
    this.context.assertActive();
  }
  async prepare(): Promise<void> {
    this.context.assertActive();
    if (!this.retained) await this.budget.schedule(this, "retained");
    this.context.assertActive();
  }
  cancel(): void {
    this.context.cancel();
    this.budget.cancelWaiting(this);
    if (!this.retiring && !this.released) {
      this.retiring = true;
      this.budget.retiring++;
    }
  }
  finish(): void {
    this.finished = true;
    if (!this.released && !this.retiring && (this.pending > 0 || this.context.pendingOperations > 0)) {
      this.retiring = true;
      this.budget.retiring++;
    }
    this.tryRelease();
  }
  private tryRelease(): void {
    if (this.released || this.pending !== 0 || this.context.pendingOperations !== 0) return;
    if (this.working) this.budget.releaseWork(this);
    if (this.finished) {
      this.released = true;
      this.budget.release(this, this.retiring);
      this.resolveRetired();
    }
  }
}

/** A module instance belongs to one JS environment, including retiring adapter instances. */
export class HostServingBudget {
  private readonly leases = new Set<ServingLease>();
  private capacityWake: (() => void) | undefined;
  private readonly waiting: ServingLease[] = [];
  private retainedBytes = 0;
  private workingBytes = 0;
  private working = 0;
  retiring = 0;
  private constructor(private policy: ServingPolicy) {}
  private static environment: HostServingBudget | undefined;
  static forEnvironment(policy: ServingPolicy): HostServingBudget {
    const budget = HostServingBudget.environment;
    if (!budget) {
      const created = new HostServingBudget(policy);
      HostServingBudget.environment = created;
      return created;
    }
    if (JSON.stringify(policy) !== JSON.stringify(budget.policy)) {
      if (budget.leases.size !== 0)
        throw new ServingConfigurationError("Serving policy changed with outstanding reservations");
      budget.policy = policy;
    }
    return budget;
  }
  subscribeCapacity(wake: () => void): () => void {
    if (this.capacityWake) throw new ServingConfigurationError("Serving capacity already subscribed");
    this.capacityWake = wake;
    return () => {
      if (this.capacityWake === wake) this.capacityWake = undefined;
    };
  }
  /** Leases acquirable now. */
  remaining(): number {
    return this.policy.capacity - this.leases.size;
  }
  acquire(peer = "", method = ReqRespMethod.BeaconBlocksByRoot): ServingLease {
    if (this.remaining() <= 0) throw new ServingCapacityError("handler admission");
    const work = this.policy.methods[method];
    if (!work) throw new ServingConfigurationError(`Unsupported serving method ${method}`);
    const lease = new ServingLease(work, peer, this);
    this.leases.add(lease);
    return lease;
  }
  schedule(lease: ServingLease, kind: "retained" | "work"): Promise<void> {
    if (!this.leases.has(lease) || lease.waiting || this.waiting.length >= this.policy.capacity)
      throw new ServingConfigurationError("Serving work queue invariant");
    const pending = defer<void>();
    lease.waiting = {kind, completion: pending};
    this.waiting.push(lease);
    this.drain();
    return pending.promise;
  }
  cancelWaiting(lease: ServingLease): void {
    if (!lease.waiting) return;
    const index = this.waiting.indexOf(lease);
    if (index < 0) throw new ServingConfigurationError("Missing serving waiter");
    this.waiting.splice(index, 1);
    const pending = lease.waiting;
    lease.waiting = undefined;
    pending.completion.resolve();
  }
  releaseWork(lease: ServingLease): void {
    if (!lease.working || this.working < 1 || this.workingBytes < lease.work.workingBytes)
      throw new ServingConfigurationError("Serving work accounting invariant");
    lease.working = false;
    this.working--;
    this.workingBytes -= lease.work.workingBytes;
    this.drain();
  }
  release(lease: ServingLease, retiring: boolean): void {
    const wasFull = this.remaining() === 0;
    if (lease.working || lease.waiting || !this.leases.delete(lease))
      throw new ServingConfigurationError("Serving lease accounting invariant");
    if (lease.retained) this.retainedBytes -= lease.work.retainedBytes;
    if (retiring) this.retiring--;
    this.drain();
    if (wasFull) this.capacityWake?.();
  }
  private drain(): void {
    const stateBytes = this.policy.capacity * this.policy.stateBytes;
    // Retained responses must leave room for a maximum production step to finish.
    const retainedLimit = this.policy.totalBytes - stateBytes - this.policy.workingBytes;
    for (let turn = 0; turn < this.policy.capacity; turn++) {
      let selected = -1;
      let active = Infinity;
      for (let i = 0; i < this.waiting.length; i++) {
        const lease = this.waiting[i];
        const retained = lease.retained ? 0 : lease.work.retainedBytes;
        const work = lease.waiting?.kind === "work";
        if (
          (work && this.working >= this.policy.maxTasks) ||
          this.retainedBytes + retained > retainedLimit ||
          stateBytes + this.retainedBytes + retained + this.workingBytes + (work ? lease.work.workingBytes : 0) >
            this.policy.totalBytes
        )
          continue;
        let peerWork = 0;
        for (const other of this.leases) if (other.working && other.peer === lease.peer) peerWork++;
        if (peerWork < active) {
          selected = i;
          active = peerWork;
        }
      }
      if (selected < 0) break;
      const [lease] = this.waiting.splice(selected, 1);
      if (!lease.retained) {
        this.retainedBytes += lease.work.retainedBytes;
        lease.retained = true;
      }
      const pending = lease.waiting;
      lease.waiting = undefined;
      if (!pending) throw new ServingConfigurationError("Missing serving work promise");
      if (pending.kind === "work") {
        this.workingBytes += lease.work.workingBytes;
        this.working++;
        lease.working = true;
      }
      pending.completion.resolve();
    }
  }
  snapshot() {
    const state = this.leases.size * this.policy.stateBytes;
    let pendingSourceLimitBytes = 0;
    for (const lease of this.leases) pendingSourceLimitBytes += lease.context.snapshot().pendingSourceLimitBytes;
    return {
      limits: this.policy,
      occupancy: this.leases.size,
      working: this.working,
      waiting: this.waiting.length,
      reservedBytes: state + this.retainedBytes + this.workingBytes,
      reservedSourceBytes: this.retainedBytes + this.workingBytes,
      /** Source-read reservations of the leases' outstanding reads, at most one source limit per lease */
      pendingSourceLimitBytes,
      retainedBytes: this.retainedBytes,
      workingBytes: this.workingBytes,
      outstandingRetirements: this.retiring,
    };
  }
}
