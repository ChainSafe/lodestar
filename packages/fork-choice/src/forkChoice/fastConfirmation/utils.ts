import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  isStartSlotOfEpoch,
} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ProtoBlock} from "../../protoArray/interface.ts";
import {CheckpointWithHex, computeTotalBalance, equalCheckpointWithHex} from "../store.ts";
import {FCRBalanceSource, FCRCache, FCRContext, FCRSnapshot, IFCRStore} from "./types.ts";

const COMMITTEE_WEIGHT_ESTIMATION_ADJUSTMENT_FACTOR = 5;

export function getBlock(ctx: FCRContext, cache: FCRCache, root: RootHex): ProtoBlock | null {
  if (cache.blockByRoot.has(root)) {
    return cache.blockByRoot.get(root) ?? null;
  }
  const block = ctx.getBlock(root);
  cache.blockByRoot.set(root, block);
  return block;
}

export function getBlockSlot(ctx: FCRContext, cache: FCRCache, blockRoot: RootHex): Slot | null {
  if (cache.slotByRoot.has(blockRoot)) {
    return cache.slotByRoot.get(blockRoot) ?? null;
  }
  const block = getBlock(ctx, cache, blockRoot);
  const slot = block?.slot ?? null;
  cache.slotByRoot.set(blockRoot, slot);
  return slot;
}

export function getBlockEpoch(ctx: FCRContext, cache: FCRCache, blockRoot: RootHex): Epoch | null {
  if (cache.epochByRoot.has(blockRoot)) {
    return cache.epochByRoot.get(blockRoot) ?? null;
  }
  const block = getBlock(ctx, cache, blockRoot);
  const epoch = block ? computeEpochAtSlot(block.slot) : null;
  cache.epochByRoot.set(blockRoot, epoch);
  return epoch;
}

export function getUnrealizedJustification(
  ctx: FCRContext,
  cache: FCRCache,
  blockRoot: RootHex
): CheckpointWithHex | null {
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return null;
  return {
    epoch: block.unrealizedJustifiedEpoch,
    root: fromHex(block.unrealizedJustifiedRoot),
    rootHex: block.unrealizedJustifiedRoot,
  };
}

export function getVotingSource(ctx: FCRContext, cache: FCRCache, blockRoot: RootHex): CheckpointWithHex | null {
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return null;
  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  const isFromPrevEpoch = computeEpochAtSlot(block.slot) < currentEpoch;
  const epoch = isFromPrevEpoch ? block.unrealizedJustifiedEpoch : block.justifiedEpoch;
  const rootHex = isFromPrevEpoch ? block.unrealizedJustifiedRoot : block.justifiedRoot;
  return {epoch, root: fromHex(rootHex), rootHex};
}

export function getCheckpointForBlock(
  ctx: FCRContext,
  _cache: FCRCache,
  blockRoot: RootHex,
  epoch: Epoch
): CheckpointWithHex | null {
  try {
    const epochStartSlot = computeStartSlotAtEpoch(epoch);
    const rootHex = ctx.getAncestor(blockRoot, epochStartSlot);
    return {epoch, root: fromHex(rootHex), rootHex};
  } catch {
    return null;
  }
}

export function getAncestorRoots(
  ctx: FCRContext,
  cache: FCRCache,
  blockRoot: RootHex,
  terminalRoot: RootHex
): RootHex[] {
  const cacheKey = `${blockRoot}:${terminalRoot}`;
  if (cache.ancestorRoots.has(cacheKey)) {
    return cache.ancestorRoots.get(cacheKey) ?? [];
  }

  const terminalBlock = getBlock(ctx, cache, terminalRoot);
  if (!terminalBlock) return [];
  let root = blockRoot;
  const ancestorRoots: RootHex[] = [];
  while (true) {
    const block = getBlock(ctx, cache, root);
    if (!block) return [];
    if (block.slot <= terminalBlock.slot) return [];
    ancestorRoots.unshift(root);
    root = block.parentRoot;
    if (root === terminalRoot) {
      cache.ancestorRoots.set(cacheKey, ancestorRoots);
      return ancestorRoots;
    }
  }
}

export function isAncestor(ctx: FCRContext, cache: FCRCache, blockRoot: RootHex, ancestorRoot: RootHex): boolean {
  const ancestorBlock = getBlock(ctx, cache, ancestorRoot);
  if (!ancestorBlock) return false;
  return ctx.getAncestor(blockRoot, ancestorBlock.slot) === ancestorRoot;
}

export function getHeadState(ctx: FCRContext, store: IFCRStore, cache: FCRCache): CachedBeaconStateAllForks | null {
  if (cache.headState !== undefined) return cache.headState;
  const headState = store.stateGetter({stateRoot: ctx.getHead().stateRoot});
  cache.headState = headState ?? null;
  return cache.headState;
}

export function getCheckpointState(
  store: IFCRStore,
  cache: FCRCache,
  checkpoint: CheckpointWithHex
): CachedBeaconStateAllForks | null {
  const key = `${checkpoint.epoch}:${checkpoint.rootHex}`;
  if (cache.checkpointStateByKey.has(key)) {
    return cache.checkpointStateByKey.get(key) ?? null;
  }
  const state = store.stateGetter({checkpoint});
  cache.checkpointStateByKey.set(key, state ?? null);
  return state ?? null;
}

export function getSlotCommittee(cache: FCRCache, state: CachedBeaconStateAllForks, slot: Slot): Set<ValidatorIndex> {
  if (cache.committeeBySlot.has(slot)) {
    return cache.committeeBySlot.get(slot) ?? new Set();
  }
  const epoch = computeEpochAtSlot(slot);
  const committeesCount = state.epochCtx.getCommitteeCountPerSlot(epoch);
  const participants = new Set<ValidatorIndex>();
  for (let i = 0; i < committeesCount; i++) {
    const committee = state.epochCtx.getBeaconCommittee(slot, i);
    for (const index of committee) {
      participants.add(index);
    }
  }
  cache.committeeBySlot.set(slot, participants);
  return participants;
}

export function getBalanceSource(store: IFCRStore, cache: FCRCache, kind: "previous" | "current"): FCRBalanceSource {
  const checkpoint =
    kind === "previous"
      ? store.previousEpochObservedJustifiedCheckpoint
      : store.currentEpochObservedJustifiedCheckpoint;
  const fallbackBalances =
    kind === "previous" ? store.previousEpochObservedJustifiedBalances : store.currentEpochObservedJustifiedBalances;
  const state = getCheckpointState(store, cache, checkpoint);
  return {
    state,
    balances: state?.epochCtx.effectiveBalanceIncrements ?? fallbackBalances,
  };
}

export function getCurrentBalanceSource(store: IFCRStore, cache: FCRCache): FCRBalanceSource {
  return getBalanceSource(store, cache, "current");
}

export function getPreviousBalanceSource(store: IFCRStore, cache: FCRCache): FCRBalanceSource {
  return getBalanceSource(store, cache, "previous");
}

export function getTotalActiveBalance(balanceSource: FCRBalanceSource): number {
  if (balanceSource.state) {
    return balanceSource.state.epochCtx.totalActiveBalanceIncrements;
  }
  return computeTotalBalance(balanceSource.balances);
}

export function estimateCommitteeWeightBetweenSlots(
  balanceSource: FCRBalanceSource,
  startSlot: Slot,
  endSlot: Slot
): number {
  if (startSlot > endSlot) return 0;
  const totalActiveBalance = getTotalActiveBalance(balanceSource);
  const startEpoch = computeEpochAtSlot(startSlot);
  const endEpoch = computeEpochAtSlot(endSlot);

  if (isFullValidatorSetCovered(startSlot, endSlot)) {
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

  return adjustCommitteeWeightEstimateToEnsureSafety(
    startEpochWeightEstimate + completeEpochsWeight + endEpochWeightEstimate
  );
}

export function adjustCommitteeWeightEstimateToEnsureSafety(estimate: number): number {
  const estimateInThousands = Math.floor(estimate / 1000);
  if (estimateInThousands === 0) {
    return estimate;
  }
  return estimateInThousands * (1000 + COMMITTEE_WEIGHT_ESTIMATION_ADJUSTMENT_FACTOR);
}

export function isFullValidatorSetCovered(startSlot: Slot, endSlot: Slot): boolean {
  const startFullEpoch = computeEpochAtSlot(startSlot + (SLOTS_PER_EPOCH - 1));
  const endFullEpoch = computeEpochAtSlot((endSlot + 1) as Slot);
  return startFullEpoch < endFullEpoch;
}

export function computeProposerScore(ctx: FCRContext, balanceSource: FCRBalanceSource): number {
  const totalActiveBalance = getTotalActiveBalance(balanceSource);
  const committeeWeight = Math.floor(totalActiveBalance / SLOTS_PER_EPOCH);
  return Math.floor((committeeWeight * ctx.config.PROPOSER_SCORE_BOOST) / 100);
}

export function getAttestationScore(ctx: FCRContext, balanceSource: FCRBalanceSource, blockRoot: RootHex): number {
  const balances = balanceSource.balances;
  const state = balanceSource.state;
  const activeIndices = state?.epochCtx.currentShuffling.activeIndices ?? null;
  let score = 0;
  const equivocating = ctx.getEquivocatingIndices();

  if (activeIndices !== null && state) {
    for (const i of activeIndices) {
      if (state.validators.get(i)?.slashed) continue;
      if (equivocating.has(i)) continue;
      const latestMessage = ctx.getLatestMessage(i);
      if (latestMessage && ctx.isDescendant(blockRoot, latestMessage.root)) {
        score += balances[i] ?? 0;
      }
    }
    return score;
  }

  for (let i = 0; i < balances.length; i++) {
    if (balances[i] === 0) continue;
    if (equivocating.has(i)) continue;
    const latestMessage = ctx.getLatestMessage(i);
    if (latestMessage && ctx.isDescendant(blockRoot, latestMessage.root)) {
      score += balances[i] ?? 0;
    }
  }
  return score;
}

export function getBlockSupportBetweenSlots(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  balanceSource: FCRBalanceSource,
  blockRoot: RootHex,
  startSlot: Slot,
  endSlot: Slot
): number {
  if (startSlot > endSlot) return 0;
  const headState = getHeadState(ctx, store, cache);
  if (!headState) return 0;
  const balances = balanceSource.balances;
  const participants = new Set<ValidatorIndex>();

  for (let slot = startSlot; slot <= endSlot; slot++) {
    for (const index of getSlotCommittee(cache, headState, slot)) {
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
    if (latestMessage && ctx.isDescendant(blockRoot, latestMessage.root)) {
      score += balances[i] ?? 0;
    }
  }
  return score;
}

export function getEquivocationScore(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  balanceSource: FCRBalanceSource,
  startSlot: Slot,
  endSlot: Slot
): number {
  if (startSlot > endSlot) return 0;
  const headState = getHeadState(ctx, store, cache);
  if (!headState) return 0;
  const balances = balanceSource.balances;
  const participants = new Set<ValidatorIndex>();

  for (let slot = startSlot; slot <= endSlot; slot++) {
    for (const index of getSlotCommittee(cache, headState, slot)) {
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

export function computeAdversarialWeight(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  balanceSource: FCRBalanceSource,
  startSlot: Slot,
  endSlot: Slot
): number {
  const maximumWeight = estimateCommitteeWeightBetweenSlots(balanceSource, startSlot, endSlot);
  const maxAdversarialWeight = Math.floor((maximumWeight * ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD) / 100);
  const equivocationScore = getEquivocationScore(ctx, store, cache, balanceSource, startSlot, endSlot);
  return maxAdversarialWeight > equivocationScore ? maxAdversarialWeight - equivocationScore : 0;
}

export function getAdversarialWeight(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  balanceSource: FCRBalanceSource,
  blockRoot: RootHex
): number {
  const currentSlot = ctx.getCurrentSlot();
  if (currentSlot === 0) return 0;
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return 0;
  const parentBlock = getBlock(ctx, cache, block.parentRoot);
  if (!parentBlock) return 0;
  const blockEpoch = computeEpochAtSlot(block.slot);
  const parentEpoch = computeEpochAtSlot(parentBlock.slot);

  if (blockEpoch > parentEpoch) {
    const startSlot = computeStartSlotAtEpoch(blockEpoch);
    return computeAdversarialWeight(ctx, store, cache, balanceSource, startSlot, (currentSlot - 1) as Slot);
  }
  return computeAdversarialWeight(ctx, store, cache, balanceSource, block.slot, (currentSlot - 1) as Slot);
}

export function computeEmptySlotSupportDiscount(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  balanceSource: FCRBalanceSource,
  blockRoot: RootHex
): number {
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return 0;
  const parentBlock = getBlock(ctx, cache, block.parentRoot);
  if (!parentBlock) return 0;

  if (parentBlock.slot + 1 === block.slot) {
    return 0;
  }

  const parentSupportInEmptySlots = getBlockSupportBetweenSlots(
    ctx,
    store,
    cache,
    balanceSource,
    block.parentRoot,
    (parentBlock.slot + 1) as Slot,
    (block.slot - 1) as Slot
  );
  const adversarialWeight = computeAdversarialWeight(
    ctx,
    store,
    cache,
    balanceSource,
    (parentBlock.slot + 1) as Slot,
    (block.slot - 1) as Slot
  );

  return parentSupportInEmptySlots > adversarialWeight ? parentSupportInEmptySlots - adversarialWeight : 0;
}

export function getSupportDiscount(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  balanceSource: FCRBalanceSource,
  blockRoot: RootHex
): number {
  return computeEmptySlotSupportDiscount(ctx, store, cache, balanceSource, blockRoot);
}

export function isOneConfirmed(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  balanceSource: FCRBalanceSource,
  blockRoot: RootHex
): boolean {
  const currentSlot = ctx.getCurrentSlot();
  if (currentSlot === 0) return false;
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return false;
  const parentBlock = getBlock(ctx, cache, block.parentRoot);
  if (!parentBlock) return false;

  const support = getAttestationScore(ctx, balanceSource, blockRoot);
  const proposerScore = computeProposerScore(ctx, balanceSource);
  const maximumSupport = estimateCommitteeWeightBetweenSlots(
    balanceSource,
    (parentBlock.slot + 1) as Slot,
    (currentSlot - 1) as Slot
  );
  const supportDiscount = getSupportDiscount(ctx, store, cache, balanceSource, blockRoot);
  const adversarialWeightBase = getAdversarialWeight(ctx, store, cache, balanceSource, blockRoot);

  const adversarialWeightScaled =
    2 * support + supportDiscount > maximumSupport + proposerScore + 2 * adversarialWeightBase;

  return adversarialWeightScaled;
}

export function getCurrentTarget(ctx: FCRContext, cache: FCRCache): CheckpointWithHex | null {
  const head = ctx.getHead().blockRoot;
  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  return getCheckpointForBlock(ctx, cache, head, currentEpoch);
}

export function getCurrentTargetState(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache
): CachedBeaconStateAllForks | null {
  const target = getCurrentTarget(ctx, cache);
  if (!target) return null;
  return getCheckpointState(store, cache, target);
}

export function getCurrentTargetScore(ctx: FCRContext, store: IFCRStore, cache: FCRCache): number {
  const target = getCurrentTarget(ctx, cache);
  const targetState = getCurrentTargetState(ctx, store, cache);
  if (!target || !targetState) return 0;
  const balances = targetState.epochCtx.effectiveBalanceIncrements;
  const activeIndices = targetState.epochCtx.currentShuffling.activeIndices;
  const equivocating = ctx.getEquivocatingIndices();
  let score = 0;
  for (const i of activeIndices) {
    if (targetState.validators.get(i)?.slashed) continue;
    if (equivocating.has(i)) continue;
    const latestMessage = ctx.getLatestMessage(i);
    if (!latestMessage) continue;
    const latestCheckpoint = getCheckpointForBlock(ctx, cache, latestMessage.root, latestMessage.epoch);
    if (latestCheckpoint && equalCheckpointWithHex(target, latestCheckpoint)) {
      score += balances[i] ?? 0;
    }
  }
  return score;
}

export function computeHonestFfgSupportForCurrentTarget(ctx: FCRContext, store: IFCRStore, cache: FCRCache): number {
  const currentSlot = ctx.getCurrentSlot();
  if (currentSlot === 0) return 0;
  const currentEpoch = computeEpochAtSlot(currentSlot);
  const targetState = getCurrentTargetState(ctx, store, cache);
  if (!targetState) return 0;
  const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
  const ffgSupport = getCurrentTargetScore(ctx, store, cache);
  const ffgWeightTillNow = estimateCommitteeWeightBetweenSlots(
    {state: targetState, balances: targetState.epochCtx.effectiveBalanceIncrements},
    computeStartSlotAtEpoch(currentEpoch),
    (currentSlot - 1) as Slot
  );

  const remainingFfgWeight = totalActiveBalance - ffgWeightTillNow;
  const remainingHonestFfgWeight =
    Math.floor(remainingFfgWeight / 100) * (100 - ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD);

  const minHonestFfgSupport =
    ffgSupport - Math.min(Math.floor(ffgWeightTillNow / 100) * ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD, ffgSupport);

  return minHonestFfgSupport + remainingHonestFfgWeight;
}

export function willNoConflictingCheckpointBeJustified(ctx: FCRContext, store: IFCRStore, cache: FCRCache): boolean {
  const target = getCurrentTarget(ctx, cache);
  if (!target) return false;
  if (equalCheckpointWithHex(target, ctx.getUnrealizedJustified().checkpoint)) {
    return true;
  }
  const targetState = getCurrentTargetState(ctx, store, cache);
  if (!targetState) return false;
  const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
  const honestSupport = computeHonestFfgSupportForCurrentTarget(ctx, store, cache);
  return 3 * honestSupport >= 1 * totalActiveBalance;
}

export function willCurrentTargetBeJustified(ctx: FCRContext, store: IFCRStore, cache: FCRCache): boolean {
  const targetState = getCurrentTargetState(ctx, store, cache);
  if (!targetState) return false;
  const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
  const honestSupport = computeHonestFfgSupportForCurrentTarget(ctx, store, cache);
  return 3 * honestSupport >= 2 * totalActiveBalance;
}

export function willCheckpointBeJustified(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  checkpoint: CheckpointWithHex
): boolean {
  const currentTarget = getCurrentTarget(ctx, cache);
  if (currentTarget && equalCheckpointWithHex(checkpoint, currentTarget)) {
    return willCurrentTargetBeJustified(ctx, store, cache);
  }

  const unrealizedJustified = ctx.getUnrealizedJustified();
  if (equalCheckpointWithHex(checkpoint, unrealizedJustified.checkpoint)) {
    return true;
  }

  const checkpointState = getCheckpointState(store, cache, checkpoint);
  if (!checkpointState) return false;

  const totalActiveBalance = checkpointState.epochCtx.totalActiveBalanceIncrements;
  const balances = checkpointState.epochCtx.effectiveBalanceIncrements;
  const activeIndices = checkpointState.epochCtx.currentShuffling.activeIndices;
  const equivocating = ctx.getEquivocatingIndices();

  let ffgSupport = 0;
  for (const i of activeIndices) {
    if (checkpointState.validators.get(i)?.slashed) continue;
    if (equivocating.has(i)) continue;
    const latestMessage = ctx.getLatestMessage(i);
    if (!latestMessage) continue;
    const latestCheckpoint = getCheckpointForBlock(ctx, cache, latestMessage.root, latestMessage.epoch);
    if (latestCheckpoint && equalCheckpointWithHex(checkpoint, latestCheckpoint)) {
      ffgSupport += balances[i] ?? 0;
    }
  }

  const currentSlot = ctx.getCurrentSlot();
  const checkpointEpoch = checkpoint.epoch;
  const ffgWeightTillNow = estimateCommitteeWeightBetweenSlots(
    {state: checkpointState, balances},
    computeStartSlotAtEpoch(checkpointEpoch),
    (currentSlot - 1) as Slot
  );

  const remainingFfgWeight = totalActiveBalance - ffgWeightTillNow;
  const remainingHonestFfgWeight =
    Math.floor(remainingFfgWeight / 100) * (100 - ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD);

  const minHonestFfgSupport =
    ffgSupport - Math.min(Math.floor(ffgWeightTillNow / 100) * ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD, ffgSupport);

  const honestSupport = minHonestFfgSupport + remainingHonestFfgWeight;
  return 3 * honestSupport >= 2 * totalActiveBalance;
}

export function isConfirmedChainSafe(
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  confirmedRoot: RootHex
): boolean {
  if (!isAncestor(ctx, cache, confirmedRoot, store.currentEpochObservedJustifiedCheckpoint.rootHex)) {
    return false;
  }

  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  let startRoot: RootHex;
  if (store.currentEpochObservedJustifiedCheckpoint.epoch + 1 >= currentEpoch) {
    startRoot = store.currentEpochObservedJustifiedCheckpoint.rootHex;
  } else {
    const checkpoint = getCheckpointForBlock(ctx, cache, confirmedRoot, (currentEpoch - 1) as Epoch);
    if (checkpoint === null) return false;
    const checkpointBlock = getBlock(ctx, cache, checkpoint.rootHex);
    if (!checkpointBlock) return false;
    startRoot = checkpointBlock.parentRoot;
  }

  const chainRoots = getAncestorRoots(ctx, cache, confirmedRoot, startRoot);
  const previousBalanceSource = getPreviousBalanceSource(store, cache);
  return chainRoots.every((root) => isOneConfirmed(ctx, store, cache, previousBalanceSource, root));
}
export function findLatestConfirmedDescendant(
  snapshot: FCRSnapshot,
  ctx: FCRContext,
  store: IFCRStore,
  cache: FCRCache,
  latestConfirmedRoot: RootHex
): RootHex {
  const currentEpoch = snapshot.currentEpoch;
  let confirmedRoot = latestConfirmedRoot;

  const previousSlotVotingSource = getVotingSource(ctx, cache, store.previousSlotHead);
  const prevSlotJustification = getUnrealizedJustification(ctx, cache, store.previousSlotHead);
  const headJustification = snapshot.headUnrealized ?? getUnrealizedJustification(ctx, cache, snapshot.headRoot);
  const currentBalanceSource = getCurrentBalanceSource(store, cache);

  const confirmedEpoch = getBlockEpoch(ctx, cache, confirmedRoot);
  const loop1Condition =
    confirmedEpoch !== null &&
    confirmedEpoch + 1 === currentEpoch &&
    previousSlotVotingSource !== null &&
    previousSlotVotingSource.epoch + 2 >= currentEpoch &&
    (isStartSlotOfEpoch(snapshot.currentSlot) ||
      (willNoConflictingCheckpointBeJustified(ctx, store, cache) &&
        ((prevSlotJustification !== null && prevSlotJustification.epoch + 1 >= currentEpoch) ||
          (headJustification !== null && headJustification.epoch + 1 >= currentEpoch))));

  if (loop1Condition) {
    const canonicalRoots = getAncestorRoots(ctx, cache, snapshot.headRoot, confirmedRoot);
    for (const blockRoot of canonicalRoots) {
      const blockEpoch = getBlockEpoch(ctx, cache, blockRoot);
      if (blockEpoch === null || blockEpoch === currentEpoch) {
        break;
      }
      if (!isAncestor(ctx, cache, store.previousSlotHead, blockRoot)) {
        break;
      }
      const isConfirmed = isOneConfirmed(ctx, store, cache, currentBalanceSource, blockRoot);
      if (!isConfirmed) {
        break;
      }
      confirmedRoot = blockRoot;
    }
  }

  const loop2Condition =
    isStartSlotOfEpoch(snapshot.currentSlot) ||
    (headJustification !== null && headJustification.epoch + 1 >= currentEpoch);

  if (loop2Condition) {
    const canonicalRoots = getAncestorRoots(ctx, cache, snapshot.headRoot, confirmedRoot);
    let tentativeConfirmedRoot = confirmedRoot;

    for (const blockRoot of canonicalRoots) {
      const blockEpoch = getBlockEpoch(ctx, cache, blockRoot);
      const tentativeEpoch = getBlockEpoch(ctx, cache, tentativeConfirmedRoot);
      if (blockEpoch === null || tentativeEpoch === null) break;

      if (blockEpoch > tentativeEpoch) {
        const blockCheckpoint = getCheckpointForBlock(ctx, cache, blockRoot, blockEpoch);
        if (!blockCheckpoint || !willCheckpointBeJustified(ctx, store, cache, blockCheckpoint)) {
          break;
        }
      }

      const isConfirmed = isOneConfirmed(ctx, store, cache, currentBalanceSource, blockRoot);
      if (!isConfirmed) {
        break;
      }
      tentativeConfirmedRoot = blockRoot;
    }

    const tentativeEpoch = getBlockEpoch(ctx, cache, tentativeConfirmedRoot);
    const tentativeVotingSource = getVotingSource(ctx, cache, tentativeConfirmedRoot);
    if (
      tentativeEpoch !== null &&
      (tentativeEpoch === currentEpoch ||
        (tentativeVotingSource !== null &&
          tentativeVotingSource.epoch + 2 >= currentEpoch &&
          (isStartSlotOfEpoch(snapshot.currentSlot) || willNoConflictingCheckpointBeJustified(ctx, store, cache))))
    ) {
      confirmedRoot = tentativeConfirmedRoot;
    }
  }

  return confirmedRoot;
}
