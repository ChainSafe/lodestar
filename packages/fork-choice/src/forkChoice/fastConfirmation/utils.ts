import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  isStartSlotOfEpoch,
} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {ProtoBlock} from "../../protoArray/interface.ts";
import {CheckpointWithHex, computeTotalBalance, equalCheckpointWithHex} from "../store.ts";
import {
  FastConfirmationBalanceSource,
  FastConfirmationCache,
  FastConfirmationContext,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "./types.ts";

const COMMITTEE_WEIGHT_ESTIMATION_ADJUSTMENT_FACTOR = 5;

export function getBlock(ctx: FastConfirmationContext, cache: FastConfirmationCache, root: RootHex): ProtoBlock | null {
  if (cache.blockByRoot.has(root)) {
    return cache.blockByRoot.get(root) ?? null;
  }
  const block = ctx.getBlock(root);
  cache.blockByRoot.set(root, block);
  return block;
}

export function getUnrealizedJustification(
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
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

export function getVotingSource(
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
  blockRoot: RootHex
): CheckpointWithHex | null {
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return null;
  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  const isFromPrevEpoch = computeEpochAtSlot(block.slot) < currentEpoch;
  const epoch = isFromPrevEpoch ? block.unrealizedJustifiedEpoch : block.justifiedEpoch;
  const rootHex = isFromPrevEpoch ? block.unrealizedJustifiedRoot : block.justifiedRoot;
  return {epoch, root: fromHex(rootHex), rootHex};
}

export function getCheckpointForBlock(
  ctx: FastConfirmationContext,
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
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
  blockRoot: RootHex,
  terminalRoot: RootHex
): RootHex[] {
  const cacheKey = `${blockRoot}:${terminalRoot}`;
  if (cache.ancestorRoots.has(cacheKey)) {
    return cache.ancestorRoots.get(cacheKey) ?? [];
  }

  const terminalBlock = getBlock(ctx, cache, terminalRoot);
  if (!terminalBlock) {
    cache.ancestorRoots.set(cacheKey, null);
    return [];
  }
  let root = blockRoot;
  const ancestorRoots: RootHex[] = [];
  while (true) {
    const block = getBlock(ctx, cache, root);
    if (!block) {
      cache.ancestorRoots.set(cacheKey, null);
      return [];
    }
    if (block.slot <= terminalBlock.slot) {
      cache.ancestorRoots.set(cacheKey, null);
      return [];
    }
    ancestorRoots.push(root);
    root = block.parentRoot;
    if (root === terminalRoot) {
      ancestorRoots.reverse();
      cache.ancestorRoots.set(cacheKey, ancestorRoots);
      return ancestorRoots;
    }
  }
}

export function isAncestor(
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
  blockRoot: RootHex,
  ancestorRoot: RootHex
): boolean {
  const ancestorBlock = getBlock(ctx, cache, ancestorRoot);
  if (!ancestorBlock) return false;
  try {
    return ctx.getAncestor(blockRoot, ancestorBlock.slot) === ancestorRoot;
  } catch {
    return false;
  }
}

export function getHeadState(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): CachedBeaconStateAllForks | null {
  if (cache.headState !== undefined) return cache.headState;
  const headState = store.stateGetter({stateRoot: ctx.getHead().stateRoot});
  cache.headState = headState ?? null;
  return cache.headState;
}

export function getCheckpointState(
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
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

export function getSlotCommittee(
  cache: FastConfirmationCache,
  state: CachedBeaconStateAllForks,
  slot: Slot
): Set<ValidatorIndex> {
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

function getSlotRangeParticipants(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  startSlot: Slot,
  endSlot: Slot
): Set<ValidatorIndex> {
  const participants = new Set<ValidatorIndex>();
  const headState = getHeadState(ctx, store, cache);
  if (!headState) return participants;

  for (let slot = startSlot; slot <= endSlot; slot++) {
    for (const index of getSlotCommittee(cache, headState, slot)) {
      participants.add(index);
    }
  }

  return participants;
}

function isDescendantCached(
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
  ancestorRoot: RootHex,
  descendantRoot: RootHex
): boolean {
  const cacheKey = `${ancestorRoot}:${descendantRoot}`;
  if (cache.isDescendantByRootPair.has(cacheKey)) {
    return cache.isDescendantByRootPair.get(cacheKey) ?? false;
  }

  const isDescendant = ctx.isDescendant(ancestorRoot, descendantRoot);
  cache.isDescendantByRootPair.set(cacheKey, isDescendant);
  return isDescendant;
}

export function getBalanceSource(
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  kind: "previous" | "current"
): FastConfirmationBalanceSource {
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

export function getCurrentBalanceSource(
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): FastConfirmationBalanceSource {
  return getBalanceSource(store, cache, "current");
}

export function getPreviousBalanceSource(
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): FastConfirmationBalanceSource {
  return getBalanceSource(store, cache, "previous");
}

export function getTotalActiveBalance(balanceSource: FastConfirmationBalanceSource): number {
  if (balanceSource.state) {
    return balanceSource.state.epochCtx.totalActiveBalanceIncrements;
  }
  return computeTotalBalance(balanceSource.balances);
}

export function estimateCommitteeWeightBetweenSlots(
  balanceSource: FastConfirmationBalanceSource,
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

export function computeProposerScore(
  ctx: FastConfirmationContext,
  balanceSource: FastConfirmationBalanceSource
): number {
  const totalActiveBalance = getTotalActiveBalance(balanceSource);
  const committeeWeight = Math.floor(totalActiveBalance / SLOTS_PER_EPOCH);
  return Math.floor((committeeWeight * ctx.config.PROPOSER_SCORE_BOOST) / 100);
}

/**
 * Build vote weight map in a single pass over all active validators.
 * Groups validators by their latest vote root, summing their balances.
 * Cached per sourceKey ("current" | "previous").
 */
function ensureVoteMaps(
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  sourceKey: "current" | "previous"
): void {
  if (cache.voteWeightBySource.has(sourceKey)) return;

  const voteMap = new Map<RootHex, number>();
  const balances = balanceSource.balances;
  const state = balanceSource.state;
  const activeIndices = state?.epochCtx.currentShuffling.activeIndices ?? null;
  const equivocating = ctx.getEquivocatingIndices();

  if (activeIndices !== null && state) {
    for (const i of activeIndices) {
      if (state.validators.get(i)?.slashed) continue;
      if (equivocating.has(i)) continue;
      const msg = ctx.getLatestMessage(i);
      if (!msg) continue;
      const weight = balances[i] ?? 0;
      if (weight === 0) continue;
      voteMap.set(msg.root, (voteMap.get(msg.root) ?? 0) + weight);
    }
  } else {
    for (let i = 0; i < balances.length; i++) {
      const weight = balances[i] ?? 0;
      if (weight === 0) continue;
      if (equivocating.has(i)) continue;
      const msg = ctx.getLatestMessage(i);
      if (!msg) continue;
      voteMap.set(msg.root, (voteMap.get(msg.root) ?? 0) + weight);
    }
  }

  cache.voteWeightBySource.set(sourceKey, voteMap);
}

export function getAttestationScore(
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  blockRoot: RootHex,
  sourceKey: "current" | "previous"
): number {
  ensureVoteMaps(ctx, cache, balanceSource, sourceKey);
  const voteMap = cache.voteWeightBySource.get(sourceKey) ?? new Map();

  let score = 0;
  for (const [voteRoot, weight] of voteMap) {
    if (isDescendantCached(ctx, cache, blockRoot, voteRoot)) {
      score += weight;
    }
  }

  return score;
}

export function getBlockSupportBetweenSlots(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  blockRoot: RootHex,
  startSlot: Slot,
  endSlot: Slot
): number {
  if (startSlot > endSlot) return 0;
  const balances = balanceSource.balances;
  const participants = getSlotRangeParticipants(ctx, store, cache, startSlot, endSlot);
  if (participants.size === 0) return 0;

  const equivocating = ctx.getEquivocatingIndices();
  let score = 0;
  for (const i of participants) {
    if (i >= balances.length) continue;
    if (balanceSource.state?.validators.get(i)?.slashed) continue;
    if (equivocating.has(i)) continue;
    const latestMessage = ctx.getLatestMessage(i);
    if (latestMessage && isDescendantCached(ctx, cache, blockRoot, latestMessage.root)) {
      score += balances[i] ?? 0;
    }
  }
  return score;
}

export function getEquivocationScore(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  startSlot: Slot,
  endSlot: Slot
): number {
  if (startSlot > endSlot) return 0;
  const balances = balanceSource.balances;
  const participants = getSlotRangeParticipants(ctx, store, cache, startSlot, endSlot);
  if (participants.size === 0) return 0;

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
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  startSlot: Slot,
  endSlot: Slot
): number {
  const maximumWeight = estimateCommitteeWeightBetweenSlots(balanceSource, startSlot, endSlot);
  const maxAdversarialWeight = Math.floor((maximumWeight * ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD) / 100);
  const equivocationScore = getEquivocationScore(ctx, store, cache, balanceSource, startSlot, endSlot);
  return maxAdversarialWeight > equivocationScore ? maxAdversarialWeight - equivocationScore : 0;
}

export function getAdversarialWeight(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
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
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
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
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  blockRoot: RootHex
): number {
  return computeEmptySlotSupportDiscount(ctx, store, cache, balanceSource, blockRoot);
}

export function isOneConfirmed(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  blockRoot: RootHex,
  sourceKey: "current" | "previous"
): boolean {
  const currentSlot = ctx.getCurrentSlot();
  if (currentSlot === 0) return false;
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return false;
  const parentBlock = getBlock(ctx, cache, block.parentRoot);
  if (!parentBlock) return false;

  const support = getAttestationScore(ctx, cache, balanceSource, blockRoot, sourceKey);
  const proposerScore = computeProposerScore(ctx, balanceSource);
  const maximumSupport = estimateCommitteeWeightBetweenSlots(
    balanceSource,
    (parentBlock.slot + 1) as Slot,
    (currentSlot - 1) as Slot
  );
  const supportDiscount = getSupportDiscount(ctx, store, cache, balanceSource, blockRoot);
  const adversarialWeightBase = getAdversarialWeight(ctx, store, cache, balanceSource, blockRoot);

  return 2 * support + supportDiscount > maximumSupport + proposerScore + 2 * adversarialWeightBase;
}

export function getCurrentTarget(ctx: FastConfirmationContext): CheckpointWithHex | null {
  const head = ctx.getHead().blockRoot;
  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  return getCheckpointForBlock(ctx, head, currentEpoch);
}

export function getCurrentTargetState(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): CachedBeaconStateAllForks | null {
  const target = getCurrentTarget(ctx);
  if (!target) return null;
  return getCheckpointState(store, cache, target);
}

export function getCurrentTargetScore(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): number {
  const target = getCurrentTarget(ctx);
  const targetState = getCurrentTargetState(ctx, store, cache);
  if (!target || !targetState) return 0;
  const balances = targetState.epochCtx.effectiveBalanceIncrements;
  const activeIndices = targetState.epochCtx.currentShuffling.activeIndices;
  const equivocating = ctx.getEquivocatingIndices();

  // Group validators by (voteRoot, voteEpoch) to avoid per-validator getCheckpointForBlock calls.
  // On mainnet ~1M validators vote for only ~50 unique (root, epoch) pairs.
  const voteGroups = new Map<string, number>();
  for (const i of activeIndices) {
    if (targetState.validators.get(i)?.slashed) continue;
    if (equivocating.has(i)) continue;
    const msg = ctx.getLatestMessage(i);
    if (!msg) continue;
    const weight = balances[i] ?? 0;
    if (weight === 0) continue;
    const groupKey = `${msg.root}:${msg.epoch}`;
    voteGroups.set(groupKey, (voteGroups.get(groupKey) ?? 0) + weight);
  }

  // Check each unique vote group's checkpoint against the target
  const targetKey = `${target.epoch}:${target.rootHex}`;
  let score = 0;
  for (const [groupKey, weight] of voteGroups) {
    const sepIdx = groupKey.lastIndexOf(":");
    const root = groupKey.slice(0, sepIdx);
    const epoch = Number(groupKey.slice(sepIdx + 1)) as Epoch;
    const cp = getCheckpointForBlock(ctx, root, epoch);
    if (cp && `${cp.epoch}:${cp.rootHex}` === targetKey) {
      score += weight;
    }
  }
  return score;
}

function computeHonestFfgSupport(
  totalActiveBalance: number,
  ffgSupport: number,
  ffgWeightTillNow: number,
  byzantineThreshold: number
): number {
  const remainingFfgWeight = totalActiveBalance - ffgWeightTillNow;
  const remainingHonestFfgWeight = Math.floor((remainingFfgWeight * (100 - byzantineThreshold)) / 100);
  const minHonestFfgSupport =
    ffgSupport - Math.min(Math.floor((ffgWeightTillNow * byzantineThreshold) / 100), ffgSupport);
  return minHonestFfgSupport + remainingHonestFfgWeight;
}

export function computeHonestFfgSupportForCurrentTarget(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): number {
  const currentSlot = ctx.getCurrentSlot();
  if (currentSlot === 0) return 0;
  const currentEpoch = computeEpochAtSlot(currentSlot);
  const targetState = getCurrentTargetState(ctx, store, cache);
  if (!targetState) return 0;
  const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
  const ffgSupport = getCurrentTargetScore(ctx, store, cache);
  const tillNowFFGWeight = estimateCommitteeWeightBetweenSlots(
    {state: targetState, balances: targetState.epochCtx.effectiveBalanceIncrements},
    computeStartSlotAtEpoch(currentEpoch),
    (currentSlot - 1) as Slot
  );
  return computeHonestFfgSupport(
    totalActiveBalance,
    ffgSupport,
    tillNowFFGWeight,
    ctx.config.CONFIRMATION_BYZANTINE_THRESHOLD
  );
}

export function willNoConflictingCheckpointBeJustified(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): boolean {
  const target = getCurrentTarget(ctx);
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

export function willCurrentTargetBeJustified(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): boolean {
  const targetState = getCurrentTargetState(ctx, store, cache);
  if (!targetState) return false;
  const totalActiveBalance = targetState.epochCtx.totalActiveBalanceIncrements;
  const honestSupport = computeHonestFfgSupportForCurrentTarget(ctx, store, cache);
  return 3 * honestSupport >= 2 * totalActiveBalance;
}

export function isConfirmedChainSafe(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  confirmedRoot: RootHex,
  logger?: Logger
): boolean {
  if (!isAncestor(ctx, cache, confirmedRoot, store.currentEpochObservedJustifiedCheckpoint.rootHex)) {
    logger?.debug("Fast confirmation chain-safety failed", {
      confirmedRoot,
      reason: "confirmed_not_descendant_of_observed_justified",
      observedJustifiedRoot: store.currentEpochObservedJustifiedCheckpoint.rootHex,
    });
    return false;
  }

  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  let startRoot: RootHex;
  if (store.currentEpochObservedJustifiedCheckpoint.epoch + 1 >= currentEpoch) {
    startRoot = store.currentEpochObservedJustifiedCheckpoint.rootHex;
  } else {
    let ancestorAtPreviousEpochStartRoot: RootHex;
    try {
      ancestorAtPreviousEpochStartRoot = ctx.getAncestor(
        confirmedRoot,
        computeStartSlotAtEpoch((currentEpoch - 1) as Epoch)
      );
    } catch {
      return false;
    }
    const ancestorAtPreviousEpochStart = getBlock(ctx, cache, ancestorAtPreviousEpochStartRoot);
    if (!ancestorAtPreviousEpochStart) return false;

    const ancestorEpoch = computeEpochAtSlot(ancestorAtPreviousEpochStart.slot);

    if (ancestorEpoch + 1 === currentEpoch) {
      startRoot = ancestorAtPreviousEpochStart.parentRoot;
    } else {
      startRoot = ancestorAtPreviousEpochStartRoot;
    }
  }

  const chainRoots = getAncestorRoots(ctx, cache, confirmedRoot, startRoot);
  const previousBalanceSource = getPreviousBalanceSource(store, cache);
  for (const root of chainRoots) {
    if (!isOneConfirmed(ctx, store, cache, previousBalanceSource, root, "previous")) {
      logger?.debug("Fast confirmation chain-safety failed", {
        confirmedRoot,
        reason: "unconfirmed_block_in_chain",
        blockRoot: root,
      });
      return false;
    }
  }
  return true;
}
export function findLatestConfirmedDescendant(
  snapshot: FastConfirmationSnapshot,
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  latestConfirmedRoot: RootHex,
  logger?: Logger
): RootHex {
  const currentEpoch = snapshot.currentEpoch;
  let confirmedRoot = latestConfirmedRoot;

  const previousSlotVotingSource = getVotingSource(ctx, cache, store.previousSlotHead);
  const prevSlotJustification = getUnrealizedJustification(ctx, cache, store.previousSlotHead);
  const headJustification = snapshot.headUnrealized ?? getUnrealizedJustification(ctx, cache, snapshot.headRoot);
  const currentBalanceSource = getCurrentBalanceSource(store, cache);

  const confirmedBlock = getBlock(ctx, cache, confirmedRoot);
  const confirmedEpoch = confirmedBlock ? computeEpochAtSlot(confirmedBlock.slot) : null;
  const loop1Condition =
    confirmedEpoch !== null &&
    confirmedEpoch + 1 === currentEpoch &&
    previousSlotVotingSource !== null &&
    previousSlotVotingSource.epoch + 2 >= currentEpoch &&
    (isStartSlotOfEpoch(snapshot.currentSlot) ||
      (willNoConflictingCheckpointBeJustified(ctx, store, cache) &&
        ((prevSlotJustification !== null && prevSlotJustification.epoch + 1 >= currentEpoch) ||
          (headJustification !== null && headJustification.epoch + 1 >= currentEpoch))));

  logger?.debug("Fast confirmation descendant search start", {
    latestConfirmedRoot,
    currentEpoch,
    headRoot: snapshot.headRoot,
    loop1Condition,
  });

  if (loop1Condition) {
    const canonicalRoots = getAncestorRoots(ctx, cache, snapshot.headRoot, confirmedRoot);
    for (const blockRoot of canonicalRoots) {
      const block = getBlock(ctx, cache, blockRoot);
      const blockEpoch = block ? computeEpochAtSlot(block.slot) : null;
      if (blockEpoch === null || blockEpoch === currentEpoch) {
        logger?.debug("Fast confirmation previous-epoch loop stopped", {
          reason: "reached_current_epoch_or_unknown_epoch",
          blockRoot,
          blockEpoch,
        });
        break;
      }
      if (!isAncestor(ctx, cache, store.previousSlotHead, blockRoot)) {
        logger?.debug("Fast confirmation previous-epoch loop stopped", {
          reason: "not_ancestor_of_previous_slot_head",
          blockRoot,
          previousSlotHead: store.previousSlotHead,
        });
        break;
      }
      const isConfirmed = isOneConfirmed(ctx, store, cache, currentBalanceSource, blockRoot, "current");
      if (!isConfirmed) {
        logger?.debug("Fast confirmation previous-epoch loop stopped", {
          reason: "block_not_one_confirmed",
          blockRoot,
        });
        break;
      }
      confirmedRoot = blockRoot;
      logger?.debug("Fast confirmation previous-epoch loop advanced", {confirmedRoot});
    }
  }

  const loop2Condition =
    isStartSlotOfEpoch(snapshot.currentSlot) ||
    (headJustification !== null && headJustification.epoch + 1 >= currentEpoch);

  if (loop2Condition) {
    const canonicalRoots = getAncestorRoots(ctx, cache, snapshot.headRoot, confirmedRoot);
    let tentativeConfirmedRoot = confirmedRoot;

    for (const blockRoot of canonicalRoots) {
      const block = getBlock(ctx, cache, blockRoot);
      const blockEpoch = block ? computeEpochAtSlot(block.slot) : null;
      const tentativeBlock = getBlock(ctx, cache, tentativeConfirmedRoot);
      const tentativeEpoch = tentativeBlock ? computeEpochAtSlot(tentativeBlock.slot) : null;
      if (blockEpoch === null || tentativeEpoch === null) break;

      if (blockEpoch > tentativeEpoch && !willCurrentTargetBeJustified(ctx, store, cache)) {
        logger?.debug("Fast confirmation current-epoch loop stopped", {
          reason: "current_target_not_justified",
          blockRoot,
          blockEpoch,
          tentativeEpoch,
        });
        break;
      }

      const isConfirmed = isOneConfirmed(ctx, store, cache, currentBalanceSource, blockRoot, "current");
      if (!isConfirmed) {
        logger?.debug("Fast confirmation current-epoch loop stopped", {
          reason: "block_not_one_confirmed",
          blockRoot,
        });
        break;
      }
      tentativeConfirmedRoot = blockRoot;
      logger?.debug("Fast confirmation current-epoch loop advanced", {tentativeConfirmedRoot});
    }

    const tentativeBlock = getBlock(ctx, cache, tentativeConfirmedRoot);
    const tentativeEpoch = tentativeBlock ? computeEpochAtSlot(tentativeBlock.slot) : null;
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

  logger?.debug("Fast confirmation descendant search result", {
    latestConfirmedRoot,
    confirmedRoot,
    loop2Condition,
  });

  return confirmedRoot;
}
