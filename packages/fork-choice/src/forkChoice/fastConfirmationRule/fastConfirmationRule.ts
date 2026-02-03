import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  EffectiveBalanceIncrements,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  getActiveValidatorIndices,
  getCurrentEpoch,
  isStartSlotOfEpoch,
} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {CheckpointWithHex, computeTotalBalance, equalCheckpointWithHex} from "../store.ts";
import {FCRMetrics} from "./metrics.ts";
import {FCRBalanceSource, FCRContext, FCRResult, IFCRStore, IFastConfirmationRule} from "./types.ts";

export * from "./metrics.ts";
export * from "./types.ts";

const COMMITTEE_WEIGHT_ESTIMATION_ADJUSTMENT_FACTOR = 5;

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
    const result = this.getLatestConfirmed(ctx);
    this.updateFCRMetrics(ctx, result);
    return result;
  }

  // Private methods
  // ---------------------
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

  private getLatestConfirmed(ctx: FCRContext): FCRResult {
    let confirmedRoot = this.store.confirmedRoot;
    const finalizedRoot = ctx.getFinalizedCheckpoint().rootHex;
    let didReset = false;

    const head = ctx.getHead().blockRoot;
    const currentSlot = ctx.getCurrentSlot();
    const currentEpoch = computeEpochAtSlot(currentSlot);
    const confirmedSlot = this.getBlockSlot(ctx, confirmedRoot);
    const confirmedEpoch = this.getBlockEpoch(ctx, confirmedRoot);

    const confirmedBlockNotAvailable = confirmedEpoch === null;
    const confirmedEpochBehindHead = confirmedEpoch && confirmedEpoch + 1 < currentEpoch;
    const notAncestorOfHead = !this.isAncestor(ctx, head, confirmedRoot);
    const allChildrenNotConfirmed =
      isStartSlotOfEpoch(ctx.getCurrentSlot()) && !this.isConfirmedChainSafe(ctx, confirmedRoot);

    if (confirmedBlockNotAvailable) {
      confirmedRoot = finalizedRoot;
      didReset = true;
    } else if (confirmedEpochBehindHead || notAncestorOfHead || allChildrenNotConfirmed) {
      didReset = confirmedRoot !== finalizedRoot;
      confirmedRoot = finalizedRoot;
    }

    const headUnrealized = this.getUnrealizedJustification(ctx, head);
    const observedSlot = this.getBlockSlot(ctx, this.store.currentEpochObservedJustifiedCheckpoint.rootHex);

    if (
      isStartSlotOfEpoch(currentSlot) &&
      this.store.currentEpochObservedJustifiedCheckpoint.epoch + 1 === currentEpoch &&
      headUnrealized !== null &&
      equalCheckpointWithHex(this.store.currentEpochObservedJustifiedCheckpoint, headUnrealized) &&
      confirmedSlot !== null &&
      observedSlot !== null &&
      confirmedSlot < observedSlot
    ) {
      confirmedRoot = this.store.currentEpochObservedJustifiedCheckpoint.rootHex;
    }

    const confirmedEpochAfterRestart = this.getBlockEpoch(ctx, confirmedRoot);
    if (confirmedEpochAfterRestart !== null && confirmedEpochAfterRestart + 1 >= currentEpoch) {
      confirmedRoot = this.findLatestConfirmedDescendant(ctx, confirmedRoot);
    }

    this.store.confirmedRoot = confirmedRoot;

    return {confirmedRoot, didReset};
  }

  private findLatestConfirmedDescendant(ctx: FCRContext, latestConfirmedRoot: RootHex): RootHex {
    const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
    let confirmedRoot = latestConfirmedRoot;

    const previousSlotVotingSource = this.getVotingSource(ctx, this.store.previousSlotHead);
    const prevSlotJustification = this.getUnrealizedJustification(ctx, this.store.previousSlotHead);
    const head = ctx.getHead().blockRoot;
    const headJustification = this.getUnrealizedJustification(ctx, head);
    const currentBalanceSource = this.getCurrentBalanceSource(ctx);

    const confirmedEpoch = this.getBlockEpoch(ctx, confirmedRoot);
    if (
      confirmedEpoch !== null &&
      confirmedEpoch + 1 === currentEpoch &&
      previousSlotVotingSource !== null &&
      previousSlotVotingSource.epoch + 2 >= currentEpoch &&
      (isStartSlotOfEpoch(ctx.getCurrentSlot()) ||
        (this.willNoConflictingCheckpointBeJustified(ctx) &&
          ((prevSlotJustification !== null && prevSlotJustification.epoch + 1 >= currentEpoch) ||
            (headJustification !== null && headJustification.epoch + 1 >= currentEpoch))))
    ) {
      const canonicalRoots = this.getAncestorRoots(ctx, head, confirmedRoot);
      for (const blockRoot of canonicalRoots) {
        const blockEpoch = this.getBlockEpoch(ctx, blockRoot);
        if (blockEpoch === null || blockEpoch === currentEpoch) {
          break;
        }
        if (!this.isAncestor(ctx, this.store.previousSlotHead, blockRoot)) {
          break;
        }
        if (!this.isOneConfirmed(ctx, currentBalanceSource, blockRoot)) {
          break;
        }
        confirmedRoot = blockRoot;
      }
    }

    if (
      isStartSlotOfEpoch(ctx.getCurrentSlot()) ||
      (headJustification !== null && headJustification.epoch + 1 >= currentEpoch)
    ) {
      const canonicalRoots = this.getAncestorRoots(ctx, head, confirmedRoot);
      let tentativeConfirmedRoot = confirmedRoot;

      for (const blockRoot of canonicalRoots) {
        const blockEpoch = this.getBlockEpoch(ctx, blockRoot);
        const tentativeEpoch = this.getBlockEpoch(ctx, tentativeConfirmedRoot);
        if (blockEpoch === null || tentativeEpoch === null) break;

        if (blockEpoch > tentativeEpoch) {
          const blockCheckpoint = this.getCheckpointForBlock(ctx, blockRoot, blockEpoch);
          if (!blockCheckpoint || !this.willCheckpointBeJustified(ctx, blockCheckpoint)) {
            break;
          }
        }

        if (!this.isOneConfirmed(ctx, currentBalanceSource, blockRoot)) {
          break;
        }
        tentativeConfirmedRoot = blockRoot;
      }

      const tentativeEpoch = this.getBlockEpoch(ctx, tentativeConfirmedRoot);
      const tentativeVotingSource = this.getVotingSource(ctx, tentativeConfirmedRoot);
      if (
        tentativeEpoch !== null &&
        (tentativeEpoch === currentEpoch ||
          (tentativeVotingSource !== null &&
            tentativeVotingSource.epoch + 2 >= currentEpoch &&
            (isStartSlotOfEpoch(ctx.getCurrentSlot()) || this.willNoConflictingCheckpointBeJustified(ctx))))
      ) {
        confirmedRoot = tentativeConfirmedRoot;
      }
    }

    return confirmedRoot;
  }

  private isConfirmedChainSafe(ctx: FCRContext, confirmedRoot: RootHex): boolean {
    if (!this.isAncestor(ctx, confirmedRoot, this.store.currentEpochObservedJustifiedCheckpoint.rootHex)) {
      return false;
    }

    const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
    let startRoot: RootHex;
    if (this.store.currentEpochObservedJustifiedCheckpoint.epoch + 1 >= currentEpoch) {
      startRoot = this.store.currentEpochObservedJustifiedCheckpoint.rootHex;
    } else {
      const checkpoint = this.getCheckpointForBlock(ctx, confirmedRoot, (currentEpoch - 1) as Epoch);
      if (checkpoint === null) return false;
      const checkpointBlock = ctx.getBlock(checkpoint.rootHex);
      if (!checkpointBlock) return false;
      startRoot = checkpointBlock.parentRoot;
    }

    const chainRoots = this.getAncestorRoots(ctx, confirmedRoot, startRoot);
    const previousBalanceSource = this.getPreviousBalanceSource(ctx);
    return chainRoots.every((root) => this.isOneConfirmed(ctx, previousBalanceSource, root));
  }

  private isOneConfirmed(ctx: FCRContext, balanceSource: FCRBalanceSource, blockRoot: RootHex): boolean {
    const currentSlot = ctx.getCurrentSlot();
    if (currentSlot === 0) return false;
    const block = ctx.getBlock(blockRoot);
    if (!block) return false;
    const parentBlock = ctx.getBlock(block.parentRoot);
    if (!parentBlock) return false;

    const support = this.getAttestationScore(ctx, balanceSource, blockRoot);
    const proposerScore = this.computeProposerScore(ctx, balanceSource);
    const maximumSupport = this.estimateCommitteeWeightBetweenSlots(
      balanceSource,
      (parentBlock.slot + 1) as Slot,
      (currentSlot - 1) as Slot
    );
    const supportDiscount = this.getSupportDiscount(ctx, balanceSource, blockRoot);

    const committeeWeightFromBlock = this.estimateCommitteeWeightBetweenSlots(
      balanceSource,
      block.slot,
      (currentSlot - 1) as Slot
    );

    const adversarialWeightBase = this.getAdversarialWeight(ctx, balanceSource, blockRoot);

    const adversarialWeightScaled =
      maximumSupport > 0 ? (adversarialWeightBase * committeeWeightFromBlock) / maximumSupport : 0;

    return 2 * support + supportDiscount > maximumSupport + proposerScore + 2 * adversarialWeightScaled;
  }

  private getAttestationScore(ctx: FCRContext, balanceSource: FCRBalanceSource, blockRoot: RootHex): number {
    const balances = balanceSource.balances;
    const state = balanceSource.state;
    const activeIndices = state ? Array.from(getActiveValidatorIndices(state, getCurrentEpoch(state))) : null;
    let score = 0;
    if (!state) return score;
    const equivocating = ctx.getEquivocatingIndices();

    if (activeIndices !== null) {
      for (const i of activeIndices) {
        if (state.validators.get(i)?.slashed) continue;
        if (equivocating.has(i)) continue;
        const latestMessage = ctx.getLatestMessage(i);
        if (latestMessage?.root === blockRoot) {
          score += balances[i] ?? 0;
        }
      }
      return score;
    }

    for (let i = 0; i < balances.length; i++) {
      if (balances[i] === 0) continue;
      if (equivocating.has(i)) continue;
      const latestMessage = ctx.getLatestMessage(i);
      if (latestMessage?.root === blockRoot) {
        score += balances[i] ?? 0;
      }
    }
    return score;
  }

  private getBlockSupportBetweenSlots(
    ctx: FCRContext,
    balanceSource: FCRBalanceSource,
    blockRoot: RootHex,
    startSlot: Slot,
    endSlot: Slot
  ): number {
    if (startSlot > endSlot) return 0;
    const headState = this.store.stateGetter({stateRoot: ctx.getHead().stateRoot});
    if (!headState) return 0;
    const balances = balanceSource.balances;
    const participants = new Set<ValidatorIndex>();

    for (let slot = startSlot; slot <= endSlot; slot++) {
      for (const index of this.getSlotCommittee(headState, slot)) {
        participants.add(index);
      }
    }

    const equivocating = ctx.getEquivocatingIndices();
    let score = 0;
    for (const i of participants) {
      if (i >= balances.length) continue;
      if (balanceSource.state?.validators.get(i)?.slashed) continue;
      if (equivocating.has(i)) continue;
      const latestMessage = ctx.getLatestMessage(i);
      if (latestMessage?.root === blockRoot) {
        score += balances[i] ?? 0;
      }
    }
    return score;
  }

  private getEquivocationScore(
    ctx: FCRContext,
    balanceSource: FCRBalanceSource,
    startSlot: Slot,
    endSlot: Slot
  ): number {
    if (startSlot > endSlot) return 0;
    const headState = this.store.stateGetter({stateRoot: ctx.getHead().stateRoot});
    if (!headState) return 0;
    const balances = balanceSource.balances;
    const participants = new Set<ValidatorIndex>();

    for (let slot = startSlot; slot <= endSlot; slot++) {
      for (const index of this.getSlotCommittee(headState, slot)) {
        participants.add(index);
      }
    }

    const equivocating = ctx.getEquivocatingIndices();
    let score = 0;
    for (const i of participants) {
      if (!equivocating.has(i)) continue;
      if (i >= balances.length) continue;
      score += balances[i] ?? 0;
    }
    return score;
  }

  private computeAdversarialWeight(
    ctx: FCRContext,
    balanceSource: FCRBalanceSource,
    startSlot: Slot,
    endSlot: Slot
  ): number {
    const maximumWeight = this.estimateCommitteeWeightBetweenSlots(balanceSource, startSlot, endSlot);
    const maxAdversarialWeight = Math.floor(maximumWeight / 100) * ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD;
    const equivocationScore = this.getEquivocationScore(ctx, balanceSource, startSlot, endSlot);
    return maxAdversarialWeight > equivocationScore ? maxAdversarialWeight - equivocationScore : 0;
  }

  private getAdversarialWeight(ctx: FCRContext, balanceSource: FCRBalanceSource, blockRoot: RootHex): number {
    const currentSlot = ctx.getCurrentSlot();
    if (currentSlot === 0) return 0;
    const block = ctx.getBlock(blockRoot);
    if (!block) return 0;
    const parentBlock = ctx.getBlock(block.parentRoot);
    if (!parentBlock) return 0;
    const blockEpoch = computeEpochAtSlot(block.slot);
    const parentEpoch = computeEpochAtSlot(parentBlock.slot);

    if (blockEpoch > parentEpoch) {
      const startSlot = computeStartSlotAtEpoch(blockEpoch);
      return this.computeAdversarialWeight(ctx, balanceSource, startSlot, (currentSlot - 1) as Slot);
    }
    return this.computeAdversarialWeight(ctx, balanceSource, block.slot, (currentSlot - 1) as Slot);
  }

  private computeEmptySlotSupportDiscount(
    ctx: FCRContext,
    balanceSource: FCRBalanceSource,
    blockRoot: RootHex
  ): number {
    const block = ctx.getBlock(blockRoot);
    if (!block) return 0;
    const parentBlock = ctx.getBlock(block.parentRoot);
    if (!parentBlock) return 0;

    if (parentBlock.slot + 1 === block.slot) {
      return 0;
    }

    const parentSupportInEmptySlots = this.getBlockSupportBetweenSlots(
      ctx,
      balanceSource,
      block.parentRoot,
      (parentBlock.slot + 1) as Slot,
      (block.slot - 1) as Slot
    );
    const adversarialWeight = this.computeAdversarialWeight(
      ctx,
      balanceSource,
      (parentBlock.slot + 1) as Slot,
      (block.slot - 1) as Slot
    );

    return parentSupportInEmptySlots > adversarialWeight ? parentSupportInEmptySlots - adversarialWeight : 0;
  }

  private getSupportDiscount(ctx: FCRContext, balanceSource: FCRBalanceSource, blockRoot: RootHex): number {
    return this.computeEmptySlotSupportDiscount(ctx, balanceSource, blockRoot);
  }

  private estimateCommitteeWeightBetweenSlots(balanceSource: FCRBalanceSource, startSlot: Slot, endSlot: Slot): number {
    if (startSlot > endSlot) return 0;
    const totalActiveBalance = this.getTotalActiveBalance(balanceSource);
    const startEpoch = computeEpochAtSlot(startSlot);
    const endEpoch = computeEpochAtSlot(endSlot);

    if (this.isFullValidatorSetCovered(startSlot, endSlot)) {
      return totalActiveBalance;
    }

    const committeeWeightPerSlot = Math.floor(totalActiveBalance / SLOTS_PER_EPOCH);

    if (startEpoch === endEpoch) {
      return committeeWeightPerSlot * (endSlot - startSlot + 1);
    }

    const numSlotsInStartEpoch = SLOTS_PER_EPOCH - computeSlotsSinceEpochStart(startSlot);
    const numSlotsInEndEpoch = computeSlotsSinceEpochStart(endSlot) + 1;

    const startEpochWeightEstimate = committeeWeightPerSlot * numSlotsInStartEpoch;
    const endEpochWeightEstimate = committeeWeightPerSlot * numSlotsInEndEpoch;

    const numCompleteEpochs = Math.max(0, endEpoch - startEpoch - 1);
    const completeEpochsWeight = totalActiveBalance * numCompleteEpochs;

    return this.adjustCommitteeWeightEstimateToEnsureSafety(
      startEpochWeightEstimate + completeEpochsWeight + endEpochWeightEstimate
    );
  }

  private adjustCommitteeWeightEstimateToEnsureSafety(estimate: number): number {
    return Math.floor(estimate / 1000) * (1000 + COMMITTEE_WEIGHT_ESTIMATION_ADJUSTMENT_FACTOR);
  }

  private isFullValidatorSetCovered(startSlot: Slot, endSlot: Slot): boolean {
    const startFullEpoch = computeEpochAtSlot(startSlot + (SLOTS_PER_EPOCH - 1));
    const endFullEpoch = computeEpochAtSlot((endSlot + 1) as Slot);
    return startFullEpoch < endFullEpoch;
  }

  private computeProposerScore(ctx: FCRContext, balanceSource: FCRBalanceSource): number {
    const totalActiveBalance = this.getTotalActiveBalance(balanceSource);
    const committeeWeight = Math.floor(totalActiveBalance / SLOTS_PER_EPOCH);
    return Math.floor((committeeWeight * ctx.config.PROPOSER_SCORE_BOOST) / 100);
  }

  private getCurrentTargetScore(ctx: FCRContext): number {
    const target = this.getCurrentTarget(ctx);
    const targetState = this.getCurrentTargetState(ctx);
    if (!target || !targetState) return 0;
    const balances = targetState.epochCtx.effectiveBalanceIncrements;
    const activeIndices = getActiveValidatorIndices(targetState, getCurrentEpoch(targetState));
    const equivocating = ctx.getEquivocatingIndices();
    let score = 0;
    for (const i of activeIndices) {
      if (targetState.validators.get(i)?.slashed) continue;
      if (equivocating.has(i)) continue;
      const latestMessage = ctx.getLatestMessage(i);
      if (!latestMessage) continue;
      const latestCheckpoint = this.getCheckpointForBlock(ctx, latestMessage.root, latestMessage.epoch);
      if (latestCheckpoint && equalCheckpointWithHex(target, latestCheckpoint)) {
        score += balances[i] ?? 0;
      }
    }
    return score;
  }

  private computeHonestFfgSupportForCurrentTarget(ctx: FCRContext): number {
    const currentSlot = ctx.getCurrentSlot();
    if (currentSlot === 0) return 0;
    const currentEpoch = computeEpochAtSlot(currentSlot);
    const targetState = this.getCurrentTargetState(ctx);
    if (!targetState) return 0;
    const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
    const ffgSupport = this.getCurrentTargetScore(ctx);
    const ffgWeightTillNow = this.estimateCommitteeWeightBetweenSlots(
      {state: targetState, balances: targetState.epochCtx.effectiveBalanceIncrements},
      computeStartSlotAtEpoch(currentEpoch),
      (currentSlot - 1) as Slot
    );

    const remainingFfgWeight = totalActiveBalance - ffgWeightTillNow;
    const remainingHonestFfgWeight =
      Math.floor(remainingFfgWeight / 100) * (100 - ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD);

    const minHonestFfgSupport =
      ffgSupport -
      Math.min(Math.floor(ffgWeightTillNow / 100) * ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD, ffgSupport);

    return minHonestFfgSupport + remainingHonestFfgWeight;
  }

  private willNoConflictingCheckpointBeJustified(ctx: FCRContext): boolean {
    const target = this.getCurrentTarget(ctx);
    if (!target) return false;
    if (equalCheckpointWithHex(target, ctx.getUnrealizedJustified().checkpoint)) {
      return true;
    }
    const targetState = this.getCurrentTargetState(ctx);
    if (!targetState) return false;
    const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
    const honestSupport = this.computeHonestFfgSupportForCurrentTarget(ctx);
    return 3 * honestSupport >= 1 * totalActiveBalance;
  }

  private willCurrentTargetBeJustified(ctx: FCRContext): boolean {
    const targetState = this.getCurrentTargetState(ctx);
    if (!targetState) return false;
    const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
    const honestSupport = this.computeHonestFfgSupportForCurrentTarget(ctx);
    return 3 * honestSupport >= 2 * totalActiveBalance;
  }

  private willCheckpointBeJustified(ctx: FCRContext, checkpoint: CheckpointWithHex): boolean {
    const currentTarget = this.getCurrentTarget(ctx);
    if (currentTarget && equalCheckpointWithHex(checkpoint, currentTarget)) {
      return this.willCurrentTargetBeJustified(ctx);
    }

    // For other checkpoints, check if it's already unrealized justified or will gather enough support
    const unrealizedJustified = ctx.getUnrealizedJustified();
    if (equalCheckpointWithHex(checkpoint, unrealizedJustified.checkpoint)) {
      return true;
    }

    // Get the state for this checkpoint to calculate potential support
    const checkpointState = this.store.stateGetter({checkpoint});
    if (!checkpointState) return false;

    const totalActiveBalance = checkpointState.epochCtx.totalActiveBalanceIncrements;
    const balances = checkpointState.epochCtx.effectiveBalanceIncrements;
    const activeIndices = getActiveValidatorIndices(checkpointState, getCurrentEpoch(checkpointState));
    const equivocating = ctx.getEquivocatingIndices();

    // Count current FFG votes for this checkpoint
    let ffgSupport = 0;
    for (const i of activeIndices) {
      if (checkpointState.validators.get(i)?.slashed) continue;
      if (equivocating.has(i)) continue;
      const latestMessage = ctx.getLatestMessage(i);
      if (!latestMessage) continue;
      const latestCheckpoint = this.getCheckpointForBlock(ctx, latestMessage.root, latestMessage.epoch);
      if (latestCheckpoint && equalCheckpointWithHex(checkpoint, latestCheckpoint)) {
        ffgSupport += balances[i] ?? 0;
      }
    }

    // Estimate remaining honest support
    const currentSlot = ctx.getCurrentSlot();
    const checkpointEpoch = checkpoint.epoch;
    const ffgWeightTillNow = this.estimateCommitteeWeightBetweenSlots(
      {state: checkpointState, balances},
      computeStartSlotAtEpoch(checkpointEpoch),
      (currentSlot - 1) as Slot
    );

    const remainingFfgWeight = totalActiveBalance - ffgWeightTillNow;
    const remainingHonestFfgWeight =
      Math.floor(remainingFfgWeight / 100) * (100 - ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD);

    const minHonestFfgSupport =
      ffgSupport -
      Math.min(Math.floor(ffgWeightTillNow / 100) * ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD, ffgSupport);

    const honestSupport = minHonestFfgSupport + remainingHonestFfgWeight;
    return 3 * honestSupport >= 2 * totalActiveBalance;
  }

  private getCurrentTarget(ctx: FCRContext): CheckpointWithHex | null {
    const head = ctx.getHead().blockRoot;
    const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
    return this.getCheckpointForBlock(ctx, head, currentEpoch);
  }

  private getCurrentTargetState(ctx: FCRContext): CachedBeaconStateAllForks | null {
    const target = this.getCurrentTarget(ctx);
    if (!target) return null;
    return this.store.stateGetter({checkpoint: target});
  }

  private getCheckpointForBlock(ctx: FCRContext, blockRoot: RootHex, epoch: Epoch): CheckpointWithHex | null {
    try {
      const epochStartSlot = computeStartSlotAtEpoch(epoch);
      const rootHex = ctx.getAncestor(blockRoot, epochStartSlot);
      return {epoch, root: fromHex(rootHex), rootHex};
    } catch {
      return null;
    }
  }

  private getVotingSource(ctx: FCRContext, blockRoot: RootHex): CheckpointWithHex | null {
    const block = ctx.getBlock(blockRoot);
    if (!block) return null;
    const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
    const isFromPrevEpoch = computeEpochAtSlot(block.slot) < currentEpoch;
    const epoch = isFromPrevEpoch ? block.unrealizedJustifiedEpoch : block.justifiedEpoch;
    const rootHex = isFromPrevEpoch ? block.unrealizedJustifiedRoot : block.justifiedRoot;
    return {epoch, root: fromHex(rootHex), rootHex};
  }

  private getUnrealizedJustification(ctx: FCRContext, blockRoot: RootHex): CheckpointWithHex | null {
    const block = ctx.getBlock(blockRoot);
    if (!block) return null;
    return {
      epoch: block.unrealizedJustifiedEpoch,
      root: fromHex(block.unrealizedJustifiedRoot),
      rootHex: block.unrealizedJustifiedRoot,
    };
  }

  private getAncestorRoots(ctx: FCRContext, blockRoot: RootHex, terminalRoot: RootHex): RootHex[] {
    const terminalBlock = ctx.getBlock(terminalRoot);
    if (!terminalBlock) return [];
    let root = blockRoot;
    const ancestorRoots: RootHex[] = [];
    while (true) {
      const block = ctx.getBlock(root);
      if (!block) return [];
      if (block.slot <= terminalBlock.slot) return [];
      ancestorRoots.unshift(root);
      root = block.parentRoot;
      if (root === terminalRoot) {
        return ancestorRoots;
      }
    }
  }

  private getBlockSlot(ctx: FCRContext, blockRoot: RootHex): Slot | null {
    const block = ctx.getBlock(blockRoot);
    return block?.slot ?? null;
  }

  private getBlockEpoch(ctx: FCRContext, blockRoot: RootHex): Epoch | null {
    const block = ctx.getBlock(blockRoot);
    return block ? computeEpochAtSlot(block.slot) : null;
  }

  private getBalanceSource(
    ctx: FCRContext,
    kind: "previous" | "current"
  ): {state: CachedBeaconStateAllForks | null; balances: EffectiveBalanceIncrements} {
    const checkpoint =
      kind === "previous"
        ? this.store.previousEpochObservedJustifiedCheckpoint
        : this.store.currentEpochObservedJustifiedCheckpoint;
    const fallbackBalances =
      kind === "previous"
        ? this.store.previousEpochObservedJustifiedBalances
        : this.store.currentEpochObservedJustifiedBalances;
    const state = this.store.stateGetter({checkpoint});
    return {
      state,
      balances: state?.epochCtx.effectiveBalanceIncrements ?? fallbackBalances,
    };
  }

  private getCurrentBalanceSource(ctx: FCRContext): FCRBalanceSource {
    return this.getBalanceSource(ctx, "current");
  }

  private getPreviousBalanceSource(ctx: FCRContext): FCRBalanceSource {
    return this.getBalanceSource(ctx, "previous");
  }

  private getSlotCommittee(state: CachedBeaconStateAllForks, slot: Slot): Set<ValidatorIndex> {
    const epoch = computeEpochAtSlot(slot);
    const committeesCount = state.epochCtx.getCommitteeCountPerSlot(epoch);
    const participants = new Set<ValidatorIndex>();
    for (let i = 0; i < committeesCount; i++) {
      const committee = state.epochCtx.getBeaconCommittee(slot, i);
      for (const index of committee) {
        participants.add(index);
      }
    }
    return participants;
  }

  private getTotalActiveBalance(balanceSource: FCRBalanceSource): number {
    if (balanceSource.state) {
      return balanceSource.state.epochCtx.totalActiveBalanceIncrements;
    }
    return computeTotalBalance(balanceSource.balances);
  }

  private isAncestor(ctx: FCRContext, blockRoot: RootHex, ancestorRoot: RootHex): boolean {
    const ancestorBlock = ctx.getBlock(ancestorRoot);
    if (!ancestorBlock) return false;
    return ctx.getAncestor(blockRoot, ancestorBlock.slot) === ancestorRoot;
  }
}
