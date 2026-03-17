import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {Logger, withObservedDuration} from "@lodestar/utils";
import {buildFastConfirmationSnapshot, createFastConfirmationCache} from "./data.ts";
import {FastConfirmationMetrics, FastConfirmationSteps} from "./metrics.ts";
import {runFastConfirmationRules} from "./rules.ts";
import {
  FastConfirmationContext,
  FastConfirmationResult,
  IFastConfirmationRule,
  IFastConfirmationStore,
} from "./types.ts";

export * from "./metrics.ts";
export * from "./types.ts";

export class FastConfirmationRule implements IFastConfirmationRule {
  constructor(
    private readonly store: IFastConfirmationStore,
    readonly metrics: FastConfirmationMetrics | null,
    readonly logger?: Logger
  ) {}

  getConfirmedRoot(): RootHex {
    return this.store.confirmedRoot;
  }

  onSlotStartAfterPastAttestationsApplied(ctx: FastConfirmationContext): FastConfirmationResult {
    const currentSlot = ctx.getCurrentSlot();
    const previousConfirmedRoot = this.store.confirmedRoot;

    this.logger?.debug("Running fast confirmation rule", {
      slot: currentSlot,
      epoch: computeEpochAtSlot(currentSlot),
    });
    this.updateFastConfirmationVariables(ctx);

    const cache = withObservedDuration(
      this.metrics?.fastConfirmation.stepsDuration.startTimer({
        step: FastConfirmationSteps.buildCache,
      }),
      createFastConfirmationCache
    );

    const snapshot = withObservedDuration(
      this.metrics?.fastConfirmation.stepsDuration.startTimer({
        step: FastConfirmationSteps.buildSnapshot,
      }),
      () => buildFastConfirmationSnapshot(ctx, this.store, cache)
    );

    this.logger?.verbose("Built fast confirmation snapshot", {
      confirmedSlot: snapshot.confirmedSlot,
      confirmedEpoch: snapshot.confirmedEpoch,
      confirmedRoot: snapshot.confirmedRoot,
      headRoot: snapshot.headRoot,
      finalizedRoot: snapshot.finalizedRoot,
      headUnrealizedRoot: snapshot.headUnrealized?.rootHex,
      headUnrealizedEpoch: snapshot.headUnrealized?.epoch,
      observedJustifiedRoot: snapshot.observedJustified.rootHex,
      observedJustifiedEpoch: snapshot.observedJustified.epoch,
    });

    const {confirmedRoot, didReset, reason} = withObservedDuration(
      this.metrics?.fastConfirmation.stepsDuration.startTimer({step: FastConfirmationSteps.runRules}),
      () => runFastConfirmationRules(snapshot, ctx, this.store, cache, this.logger)
    );

    const changed = confirmedRoot !== previousConfirmedRoot;
    const confirmedBlock = cache.blockByRoot.get(confirmedRoot) ?? null;
    const confirmedSlot = confirmedBlock?.slot ?? null;
    const confirmedEpoch = confirmedBlock ? computeEpochAtSlot(confirmedBlock.slot) : null;
    const logContext = {
      previousConfirmedRoot,
      confirmedRoot,
      changed,
      didReset,
      reason,
      confirmedSlot,
      confirmedEpoch,
    };

    if (changed) {
      this.logger?.info(didReset ? "Reset fast confirmation" : "Updated fast confirmation", logContext);
    } else {
      this.logger?.debug("Unchanged fast confirmation", logContext);
    }

    this.store.confirmedRoot = confirmedRoot;
    this.updateFastConfirmationMetrics(ctx, {confirmedRoot, didReset});

    return {confirmedRoot, didReset};
  }

  private updateFastConfirmationVariables(ctx: FastConfirmationContext): void {
    const previousSlotHead = this.store.currentSlotHead;
    const currentSlotHead = ctx.getHead().blockRoot;
    const currentSlot = ctx.getCurrentSlot();
    const isStartSlotOfCurrentEpoch = isStartSlotOfEpoch(currentSlot);
    const isLastSlotOfCurrentEpoch = isStartSlotOfEpoch(currentSlot + 1);

    this.store.previousSlotHead = previousSlotHead;
    this.store.currentSlotHead = currentSlotHead;

    this.logger?.verbose("Updating fast confirmation variables", {
      previousSlotHead,
      currentSlotHead,
      currentSlot,
      isStartSlotOfCurrentEpoch,
      isLastSlotOfCurrentEpoch,
    });

    // Spec step 1: freeze the greatest unrealized justified checkpoint at the
    // last slot of the epoch so the next epoch consumes a stable snapshot.
    if (isLastSlotOfCurrentEpoch) {
      const unrealized = ctx.getUnrealizedJustified();
      this.store.previousEpochGreatestUnrealizedCheckpoint = unrealized.checkpoint;
      this.store.previousEpochGreatestUnrealizedBalances = unrealized.balances;

      this.logger?.verbose("Updated fast confirmation greatest unrealized snapshot", {
        previousEpochGreatestUnrealizedCheckpointRoot: this.store.previousEpochGreatestUnrealizedCheckpoint.rootHex,
        previousEpochGreatestUnrealizedCheckpointEpoch: this.store.previousEpochGreatestUnrealizedCheckpoint.epoch,
      });
    }

    // Spec step 2: rotate observed justified checkpoints at the first slot of
    // the new epoch using the snapshot taken at the end of the previous epoch.
    if (isStartSlotOfCurrentEpoch) {
      this.store.previousEpochObservedJustifiedCheckpoint = this.store.currentEpochObservedJustifiedCheckpoint;
      this.store.previousEpochObservedJustifiedBalances = this.store.currentEpochObservedJustifiedBalances;
      this.store.currentEpochObservedJustifiedCheckpoint = this.store.previousEpochGreatestUnrealizedCheckpoint;
      this.store.currentEpochObservedJustifiedBalances = this.store.previousEpochGreatestUnrealizedBalances;

      this.logger?.verbose("Updated fast confirmation observed justified checkpoints", {
        previousEpochObservedJustifiedCheckpointRoot: this.store.previousEpochObservedJustifiedCheckpoint.rootHex,
        previousEpochObservedJustifiedCheckpointEpoch: this.store.previousEpochObservedJustifiedCheckpoint.epoch,
        currentEpochObservedJustifiedCheckpointRoot: this.store.currentEpochObservedJustifiedCheckpoint.rootHex,
        currentEpochObservedJustifiedCheckpointEpoch: this.store.currentEpochObservedJustifiedCheckpoint.epoch,
      });
    }
  }

  private updateFastConfirmationMetrics(ctx: FastConfirmationContext, result: FastConfirmationResult): void {
    if (!this.metrics) return;
    const confirmedBlock = ctx.getBlock(result.confirmedRoot);
    if (confirmedBlock) {
      this.metrics.fastConfirmation.confirmedSlot.set(confirmedBlock.slot);
      this.metrics.fastConfirmation.confirmedEpoch.set(computeEpochAtSlot(confirmedBlock.slot));
    } else {
      this.metrics.fastConfirmation.confirmedSlot.set(0);
      this.metrics.fastConfirmation.confirmedEpoch.set(0);
    }
    if (result.didReset) {
      this.metrics.fastConfirmation.resets.inc();
    }
    this.metrics.fastConfirmation.votesTracked.set(ctx.getTrackedVotesCount());
  }
}
