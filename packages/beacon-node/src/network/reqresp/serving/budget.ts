import {defer} from "@lodestar/utils";
import {ServingCapacityError, ServingConfigurationError, ServingContext} from "../../../chain/serving/context.js";
import {ServingPolicy} from "./policy.js";

export class ServingLease {
  readonly context: ServingContext;
  readonly retired: Promise<void>;
  private readonly resolveRetired: () => void;
  private pending = 0;
  private finished = false;
  private released = false;
  private retiring = false;
  constructor(
    readonly policy: ServingPolicy,
    private readonly budget: HostServingBudget
  ) {
    const retired = defer<void>();
    this.retired = retired.promise;
    this.resolveRetired = retired.resolve;
    this.context = new ServingContext(policy, () => this.tryRelease());
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
  cancel(): void {
    this.context.cancel();
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
    if (!this.released && this.finished && this.pending === 0 && this.context.pendingOperations === 0) {
      this.released = true;
      this.budget.release(this.policy.reservationBytes, this.retiring);
      this.resolveRetired();
    }
  }
}

/** A module instance belongs to one JS environment, including retiring adapter instances. */
export class HostServingBudget {
  private occupancy = 0;
  private reservedBytes = 0;
  private refused = 0;
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
      if (budget.occupancy !== 0)
        throw new ServingConfigurationError("Serving policy changed with outstanding reservations");
      budget.policy = policy;
    }
    return budget;
  }
  canAcquire(): boolean {
    return this.occupancy < this.policy.capacity;
  }
  acquire(): ServingLease {
    if (!this.canAcquire()) {
      this.refused++;
      throw new ServingCapacityError("handler admission");
    }
    this.occupancy++;
    this.reservedBytes += this.policy.reservationBytes;
    return new ServingLease(this.policy, this);
  }
  release(bytes: number, retiring: boolean): void {
    if (this.occupancy < 1 || this.reservedBytes < bytes)
      throw new ServingConfigurationError("Serving lease accounting invariant");
    this.occupancy--;
    this.reservedBytes -= bytes;
    if (retiring) this.retiring--;
  }
  snapshot() {
    return {
      limits: this.policy,
      occupancy: this.occupancy,
      reservedBytes: this.reservedBytes,
      reservedSourceBytes: this.occupancy * 4 * this.policy.sourceBytes,
      reservedDecodedBytes: this.occupancy * this.policy.decodedBytes,
      refusedAdmission: this.refused,
      outstandingRetirements: this.retiring,
    };
  }
}
