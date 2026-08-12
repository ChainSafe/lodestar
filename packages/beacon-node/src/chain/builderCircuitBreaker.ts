import {IForkChoice} from "@lodestar/fork-choice";
import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {getFaultInspectionParams} from "../execution/builder/http.js";
import {Metrics} from "../metrics/index.js";

export type BuilderCircuitBreakerOpts = {
  faultInspectionWindow?: number;
  allowedFaults?: number;
};

export type BuilderCircuitBreakerModules = {
  forkChoice: IForkChoice;
  logger: Logger;
  metrics: Metrics | null;
};

/** Four observations is the minimum useful recovery sample for the default ~25% fault budget */
const MIN_BLOCKS_TO_DEACTIVATE = 4;

/**
 * Post-gloas circuit breaker for builder bids. The beacon block is produced by the proposer
 * regardless of bid source, so missed blocks are not a useful builder health signal. Instead
 * count blocks whose payload was never revealed. Activate when the non-reveal rate exceeds the
 * fault budget, and resume selecting builder bids only when the observed blocks are within budget
 * and meet the minimum recovery sample size.
 */
export class BuilderCircuitBreaker {
  readonly faultInspectionWindow: number;
  readonly allowedFaults: number;

  private active = false;
  private lastUpdatedSlot = -1;

  constructor(
    opts: BuilderCircuitBreakerOpts,
    private readonly modules: BuilderCircuitBreakerModules
  ) {
    const {faultInspectionWindow, allowedFaults} = getFaultInspectionParams(opts);
    this.faultInspectionWindow = faultInspectionWindow;
    this.allowedFaults = allowedFaults;
  }

  /** Whether builder bids must be ignored for a block produced at clockSlot */
  isActive(clockSlot: Slot): boolean {
    this.update(clockSlot);
    return this.active;
  }

  update(clockSlot: Slot): void {
    if (clockSlot <= this.lastUpdatedSlot) {
      return;
    }
    this.lastUpdatedSlot = clockSlot;

    // Exclude clockSlot itself, its payload reveal may still be in flight
    const {blocksPresent, payloadsRevealed} = this.modules.forkChoice.getPayloadRevealCounts(
      Math.max(clockSlot - this.faultInspectionWindow, 0),
      clockSlot - 1
    );
    const faults = blocksPresent - payloadsRevealed;

    const wasActive = this.active;
    // Scale the fault budget by blocks present so sparse windows still trigger on high non-reveal rates
    const exceedsFaultBudget = faults * this.faultInspectionWindow > this.allowedFaults * blocksPresent;
    if (exceedsFaultBudget) {
      this.active = true;
    } else if (blocksPresent >= MIN_BLOCKS_TO_DEACTIVATE) {
      // Require a minimum sample within the fault budget before accepting builder bids again
      this.active = false;
    }

    this.modules.metrics?.builderCircuitBreaker.active.set(this.active ? 1 : 0);
    this.modules.metrics?.builderCircuitBreaker.faults.set(faults);
    this.modules.metrics?.builderCircuitBreaker.blocksPresent.set(blocksPresent);
    this.modules.metrics?.builderCircuitBreaker.payloadsRevealed.set(payloadsRevealed);

    const logCtx = {
      clockSlot,
      blocksPresent,
      faults,
      faultInspectionWindow: this.faultInspectionWindow,
      allowedFaults: this.allowedFaults,
    };
    if (this.active !== wasActive) {
      if (this.active) {
        this.modules.logger.warn("Builder circuit breaker activated, ignoring builder bids", logCtx);
      } else {
        this.modules.logger.info("Builder circuit breaker deactivated", logCtx);
      }
    } else {
      this.modules.logger.verbose("Builder circuit breaker status", {active: this.active, ...logCtx});
    }
  }
}
