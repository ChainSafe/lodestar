import {computeEpochAtSlot, isStartSlotOfEpoch} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {buildFCRSnapshot, createFCRCache} from "./fcrData.ts";
import {FCRMetrics} from "./metrics.ts";
import {runFCRRules} from "./rules.ts";
import {FCRContext, FCRResult, IFCRStore, IFastConfirmationRule} from "./types.ts";

export * from "./metrics.ts";
export * from "./types.ts";

export class FastConfirmationRule implements IFastConfirmationRule {
  constructor(
    private readonly store: IFCRStore,
    readonly metrics: FCRMetrics | null
  ) {}

  getConfirmedRoot(): RootHex {
    return this.store.confirmedRoot;
  }

  onSlotStartAfterPastAttestationsApplied(ctx: FCRContext): FCRResult {
    this.updateFCRVariables(ctx);

    const cache = createFCRCache();
    const snapshot = buildFCRSnapshot(ctx, this.store, cache);

    const {confirmedRoot, didReset} = runFCRRules(snapshot, ctx, this.store, cache);

    this.store.confirmedRoot = confirmedRoot;
    this.updateFCRMetrics(ctx, {confirmedRoot, didReset});

    return {confirmedRoot, didReset};
  }

  private updateFCRVariables(ctx: FCRContext): void {
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

  private updateFCRMetrics(ctx: FCRContext, result: FCRResult): void {
    if (!this.metrics) return;
    const confirmedBlock = ctx.getBlock(result.confirmedRoot);
    if (confirmedBlock) {
      this.metrics.fcr.confirmedSlot.set(confirmedBlock.slot);
      this.metrics.fcr.confirmedEpoch.set(computeEpochAtSlot(confirmedBlock.slot));
    } else {
      this.metrics.fcr.confirmedSlot.set(0);
      this.metrics.fcr.confirmedEpoch.set(0);
    }
    if (result.didReset) {
      this.metrics.fcr.resets.inc();
    }
    this.metrics.fcr.votesTracked.set(ctx.getTrackedVotesCount());
  }
}
