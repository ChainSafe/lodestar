import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {buildFastConfirmationSnapshot, createFastConfirmationCache} from "./data.ts";
import {FastConfirmationMetrics} from "./metrics.ts";
import {runFastConfirmationRules} from "./rules.ts";
import {
  FastConfirmationContext,
  FatsConfirmationResult,
  IFastConfirmationRule,
  IFastConfirmationStore,
} from "./types.ts";

export * from "./metrics.ts";
export * from "./types.ts";

export class FastConfirmationRule implements IFastConfirmationRule {
  constructor(
    private readonly store: IFastConfirmationStore,
    readonly metrics: FastConfirmationMetrics | null
  ) {}

  getConfirmedRoot(): RootHex {
    return this.store.confirmedRoot;
  }

  onSlotStartAfterPastAttestationsApplied(ctx: FastConfirmationContext): FatsConfirmationResult {
    this.updateFastConfirmationVariables(ctx);

    const cache = createFastConfirmationCache();
    const snapshot = buildFastConfirmationSnapshot(ctx, this.store, cache);

    const {confirmedRoot, didReset, reason: _} = runFastConfirmationRules(snapshot, ctx, this.store, cache);

    this.store.confirmedRoot = confirmedRoot;
    this.updateFastConfirmationMetrics(ctx, {confirmedRoot, didReset});

    return {confirmedRoot, didReset};
  }

  private updateFastConfirmationVariables(ctx: FastConfirmationContext): void {
    this.store.previousSlotHead = this.store.currentSlotHead;
    this.store.currentSlotHead = ctx.getHead().blockRoot;

    if (isStartSlotOfEpoch(ctx.getCurrentSlot() + 1)) {
      this.store.previousEpochObservedJustifiedCheckpoint = this.store.currentEpochObservedJustifiedCheckpoint;
      this.store.previousEpochObservedJustifiedBalances = this.store.currentEpochObservedJustifiedBalances;
      const unrealized = ctx.getUnrealizedJustified();
      this.store.currentEpochObservedJustifiedCheckpoint = unrealized.checkpoint;
      this.store.currentEpochObservedJustifiedBalances = unrealized.balances;
    }
  }

  private updateFastConfirmationMetrics(ctx: FastConfirmationContext, result: FatsConfirmationResult): void {
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
