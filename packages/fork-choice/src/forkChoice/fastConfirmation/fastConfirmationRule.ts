import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {buildFastConfirmationSnapshot, createFastConfirmationCache} from "./data.ts";
import {FastConfirmationMetrics} from "./metrics.ts";
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

    const cache = createFastConfirmationCache();
    const snapshot = buildFastConfirmationSnapshot(ctx, this.store, cache);

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

    const {confirmedRoot, didReset, reason} = runFastConfirmationRules(snapshot, ctx, this.store, cache);

    const changed = confirmedRoot !== previousConfirmedRoot;
    const confirmedSlot = cache.slotByRoot.get(confirmedRoot) ?? null;
    const confirmedEpoch = cache.epochByRoot.get(confirmedRoot) ?? null;
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
      this.logger?.info(didReset ? "Reset fast confirmation": "Updated fast confirmation", logContext);
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
    const isLastSlotOfCurrentEpoch = isStartSlotOfEpoch(currentSlot + 1);

    this.store.previousSlotHead = previousSlotHead;
    this.store.currentSlotHead = currentSlotHead;

    this.logger?.verbose("Updating fast confirmation variables", {
      previousSlotHead,
      currentSlotHead,
      currentSlot,
      isLastSlotOfCurrentEpoch,
    });

    if (isLastSlotOfCurrentEpoch) {
      this.store.previousEpochObservedJustifiedCheckpoint = this.store.currentEpochObservedJustifiedCheckpoint;
      this.store.previousEpochObservedJustifiedBalances = this.store.currentEpochObservedJustifiedBalances;
      const unrealized = ctx.getUnrealizedJustified();
      this.store.currentEpochObservedJustifiedCheckpoint = unrealized.checkpoint;
      this.store.currentEpochObservedJustifiedBalances = unrealized.balances;

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
