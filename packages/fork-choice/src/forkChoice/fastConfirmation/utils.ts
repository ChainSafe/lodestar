import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  EffectiveBalanceIncrements,
  IBeaconStateView,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  isActiveValidator,
  isStartSlotOfEpoch,
} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "../../protoArray/interface.js";
import {CheckpointWithHex, computeTotalBalance, equalCheckpointWithHex} from "../store.js";
import {
  ActiveBalances,
  type BalanceSourceCacheKey,
  type BalanceSourceKey,
  CommitteeSweep,
  FastConfirmationBalanceSource,
  FastConfirmationCache,
  FastConfirmationContext,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "./types.js";

const SAFETY_THRESHOLD_UNREACHABLE = Object.freeze({
  threshold: Number.POSITIVE_INFINITY,
  proposerScore: 0,
  maximumSupport: 0,
  supportDiscount: 0,
  adversarialWeight: 0,
});

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

// Spec: `get_ancestor_roots`
// https://github.com/ethereum/consensus-specs/blob/master/specs/phase0/fast-confirmation.md#get_ancestor_roots
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

  let block = getBlock(ctx, cache, root);
  while (block && block.slot > terminalBlock.slot) {
    ancestorRoots.push(root);
    root = block.parentRoot;

    if (root === terminalRoot) {
      ancestorRoots.reverse();
      cache.ancestorRoots.set(cacheKey, ancestorRoots);
      return ancestorRoots;
    }

    block = getBlock(ctx, cache, root);
  }

  cache.ancestorRoots.set(cacheKey, null);
  return [];
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
): IBeaconStateView {
  if (cache.headState !== undefined) return cache.headState;
  const headState = store.stateGetter({stateRoot: ctx.getHead().stateRoot});
  if (!headState) throw new Error(`Head state not found for root ${ctx.getHead().stateRoot}`);
  cache.headState = headState;
  return cache.headState;
}

export function getPulledUpHeadState(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): IBeaconStateView {
  if (cache.pulledUpHeadState !== undefined) return cache.pulledUpHeadState;

  const headState = getHeadState(ctx, store, cache);
  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  cache.pulledUpHeadState =
    headState.epoch < currentEpoch ? headState.processSlots(computeStartSlotAtEpoch(currentEpoch)) : headState;
  return cache.pulledUpHeadState;
}

export function getCheckpointState(
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  checkpoint: CheckpointWithHex
): IBeaconStateView | null {
  const key = `${checkpoint.epoch}:${checkpoint.rootHex}`;
  if (cache.checkpointStateByKey.has(key)) {
    return cache.checkpointStateByKey.get(key) ?? null;
  }
  const state = store.stateGetter({checkpoint});
  cache.checkpointStateByKey.set(key, state ?? null);
  return state ?? null;
}

/**
 * Spec: get_slot_committee, for the slots `startSlot..endSlot`.
 * Call sites share a handful of end slots (mostly `current_slot - 1`) across many start slots, so the
 * sweep is built once per end slot and extended backwards on demand instead of once per range, which
 * on mainnet would be up to ~1M validators per evaluated block.
 */
function getCommitteeSweep(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  startSlot: Slot,
  endSlot: Slot
): CommitteeSweep {
  const headState = getHeadState(ctx, store, cache);
  let sweep = cache.committeeSweepByEndSlot.get(endSlot);
  if (sweep === undefined) {
    sweep = {
      seen: new Uint8Array(headState.validatorCount),
      order: new Uint32Array(headState.validatorCount),
      lengths: [],
      weightsByKey: new Map(),
    };
    cache.committeeSweepByEndSlot.set(endSlot, sweep);
  }

  let length = sweep.lengths.at(-1) ?? 0;
  for (let slot = endSlot - sweep.lengths.length; slot >= startSlot; slot--) {
    const committeesCount = headState.getBeaconCommitteeCountPerSlot(computeEpochAtSlot(slot));
    for (let i = 0; i < committeesCount; i++) {
      for (const index of headState.getBeaconCommittee(slot, i)) {
        if (sweep.seen[index] === 1) continue;
        sweep.seen[index] = 1;
        sweep.order[length++] = index;
      }
    }
    sweep.lengths.push(length);
  }
  return sweep;
}

function getSlotRangeParticipants(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  startSlot: Slot,
  endSlot: Slot
): Uint32Array {
  const sweep = getCommitteeSweep(ctx, store, cache, startSlot, endSlot);
  return sweep.order.subarray(0, sweep.lengths[endSlot - startSlot]);
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
    balances: state?.effectiveBalanceIncrements ?? fallbackBalances,
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

/**
 * Balances with inactive and slashed validators zeroed.
 * Full-registry scans read weights from here: `state.getValidator()` materializes a validator
 * object per index on native state views.
 */
function getZeroInactiveBalances(balanceSource: FastConfirmationBalanceSource): EffectiveBalanceIncrements {
  // Fallback balances come from the justified-balance path and already zero inactive validators
  return balanceSource.state?.getEffectiveBalanceIncrementsZeroInactive() ?? balanceSource.balances;
}

/**
 * Balances read by `get_total_active_balance` and `compute_committee_weight_between_slots`. Unlike the
 * vote scans, these keep slashed validators: the maximum support and the adversarial budget they bound
 * must cover slashed equivocators, whose weight `getEquivocationScore` subtracts. `unslashedTotal` serves
 * `compute_proposer_score`, whose `calculate_committee_fraction` excludes slashed validators.
 * Invariant per balance source within a run, but read many times per is_one_confirmed evaluation
 * across the epoch-boundary chain walk; memoized so the full validator-set scan runs once per run.
 */
function getActiveBalances(balanceSource: FastConfirmationBalanceSource, cache: FastConfirmationCache): ActiveBalances {
  const key: BalanceSourceCacheKey = balanceSource.state ?? balanceSource.balances;
  const cached = cache.activeBalancesByKey.get(key);
  if (cached !== undefined) return cached;

  let active: ActiveBalances;
  if (balanceSource.state) {
    const {effectiveBalanceIncrements} = balanceSource.state;
    const unslashedBalances = balanceSource.state.getEffectiveBalanceIncrementsZeroInactive();
    const balances = new Uint16Array(balanceSource.state.validatorCount);
    let total = 0;
    let unslashedTotal = 0;
    for (const i of balanceSource.state.getCurrentShuffling().activeIndices) {
      balances[i] = effectiveBalanceIncrements[i];
      total += balances[i];
      unslashedTotal += unslashedBalances[i];
    }
    active = {balances, total, unslashedTotal};
  } else {
    // Fallback balances come from the justified-balance path, which also zeroes slashed validators
    const total = computeTotalBalance(balanceSource.balances);
    active = {balances: balanceSource.balances, total, unslashedTotal: total};
  }

  cache.activeBalancesByKey.set(key, active);
  return active;
}

export function getTotalActiveBalance(
  balanceSource: FastConfirmationBalanceSource,
  cache: FastConfirmationCache
): number {
  return getActiveBalances(balanceSource, cache).total;
}

export function computeCommitteeWeightBetweenSlots(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  startSlot: Slot,
  endSlot: Slot
): number {
  if (startSlot > endSlot) return 0;

  if (isFullValidatorSetCovered(startSlot, endSlot)) {
    return getTotalActiveBalance(balanceSource, cache);
  }

  const sweep = getCommitteeSweep(ctx, store, cache, startSlot, endSlot);
  const key: BalanceSourceCacheKey = balanceSource.state ?? balanceSource.balances;
  let weights = sweep.weightsByKey.get(key);
  if (weights === undefined) {
    weights = [];
    sweep.weightsByKey.set(key, weights);
  }

  const slotCount = endSlot - startSlot + 1;
  if (weights.length < slotCount) {
    const {balances} = getActiveBalances(balanceSource, cache);
    let weight = weights.at(-1) ?? 0;
    for (let i = weights.length; i < slotCount; i++) {
      for (let j = i > 0 ? sweep.lengths[i - 1] : 0; j < sweep.lengths[i]; j++) {
        weight += balances[sweep.order[j]] ?? 0;
      }
      weights.push(weight);
    }
  }
  return weights[slotCount - 1];
}

export function isFullValidatorSetCovered(startSlot: Slot, endSlot: Slot): boolean {
  const startFullEpoch = computeEpochAtSlot(startSlot + (SLOTS_PER_EPOCH - 1));
  const endFullEpoch = computeEpochAtSlot((endSlot + 1) as Slot);
  return startFullEpoch < endFullEpoch;
}

export function computeProposerScore(
  ctx: FastConfirmationContext,
  balanceSource: FastConfirmationBalanceSource,
  cache: FastConfirmationCache
): number {
  const {unslashedTotal} = getActiveBalances(balanceSource, cache);
  const committeeWeight = Math.floor(unslashedTotal / SLOTS_PER_EPOCH);
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
  sourceKey: BalanceSourceKey
): void {
  if (cache.voteWeightBySource.has(sourceKey)) return;

  const voteMap = new Map<RootHex, number>();
  const balances = getZeroInactiveBalances(balanceSource);
  const activeIndices = balanceSource.state?.getCurrentShuffling().activeIndices ?? null;
  const equivocating = ctx.getEquivocatingIndices();
  const indices: Iterable<number> = activeIndices ?? balances.keys();

  for (const i of indices) {
    if (equivocating.has(i)) continue;
    const weight = balances[i] ?? 0;
    if (weight === 0) continue;
    const msg = ctx.getLatestMessage(i);
    if (!msg) continue;
    voteMap.set(msg.root, (voteMap.get(msg.root) ?? 0) + weight);
  }

  cache.voteWeightBySource.set(sourceKey, voteMap);
}

export function getAttestationScore(
  ctx: FastConfirmationContext,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  blockRoot: RootHex,
  sourceKey: BalanceSourceKey
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

export function getNodeSupportBetweenSlots(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  nodeRoot: RootHex,
  nodePayloadStatus: PayloadStatus,
  startSlot: Slot,
  endSlot: Slot
): number {
  if (startSlot > endSlot) return 0;
  const balances = getZeroInactiveBalances(balanceSource);
  const participants = getSlotRangeParticipants(ctx, store, cache, startSlot, endSlot);
  if (participants.length === 0) return 0;

  const equivocating = ctx.getEquivocatingIndices();
  let score = 0;
  for (const i of participants) {
    const weight = balances[i] ?? 0;
    if (weight === 0) continue;
    if (equivocating.has(i)) continue;
    const latestMessage = ctx.getLatestMessage(i);
    if (latestMessage?.root === nodeRoot && latestMessage.payloadStatus === nodePayloadStatus) {
      score += weight;
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

  // Equivocators are extremely rare (none in normal operation). With none, the equivocation score is
  // always 0, so return before building the slot-range participant set, which otherwise spans up to a
  // full epoch of committees (~all active validators) and is rebuilt on every is_one_confirmed
  // evaluation. This build dominates fast-confirmation cost, especially the epoch-boundary chain walk.
  const equivocating = ctx.getEquivocatingIndices();
  if (equivocating.size === 0) return 0;

  const balances = balanceSource.balances;
  const state = balanceSource.state;
  const stateEpoch = state ? computeEpochAtSlot(state.slot) : null;
  const participants = getSlotRangeParticipants(ctx, store, cache, startSlot, endSlot);
  if (participants.length === 0) return 0;

  let score = 0;
  for (const i of participants) {
    if (!equivocating.has(i)) continue;
    if (i >= balances.length) continue;
    // Slashed equivocators still count, so this cannot read the zero-inactive balances.
    // Reads are bounded by the equivocating set.
    const validator = state?.getValidator(i);
    if (validator && stateEpoch !== null && !isActiveValidator(validator, stateEpoch)) continue;
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
  const maximumWeight = computeCommitteeWeightBetweenSlots(ctx, store, cache, balanceSource, startSlot, endSlot);
  // The spec uses raw Gwei and computes `maximum_weight // 100 * threshold`.
  // Lodestar carries effective-balance increments instead, so divide after multiplying to avoid
  // dropping the adversarial budget to zero for small validator sets/minimal presets.
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

  // Post-Gloas the parent block has PENDING, EMPTY and FULL nodes. Only the support of the node this
  // block actually extends is discounted; votes for the other parent nodes are not support for it.
  const parentNodePayloadStatus = ctx.getParentNodePayloadStatus(blockRoot);
  if (parentNodePayloadStatus === null) return 0;

  const parentSupportInEmptySlots = getNodeSupportBetweenSlots(
    ctx,
    store,
    cache,
    balanceSource,
    block.parentRoot,
    parentNodePayloadStatus,
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

export function computeSafetyThreshold(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  blockRoot: RootHex
): {
  threshold: number;
  proposerScore: number;
  maximumSupport: number;
  supportDiscount: number;
  adversarialWeight: number;
} {
  const currentSlot = ctx.getCurrentSlot();
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) {
    return SAFETY_THRESHOLD_UNREACHABLE;
  }
  const parentBlock = getBlock(ctx, cache, block.parentRoot);
  if (!parentBlock) {
    return SAFETY_THRESHOLD_UNREACHABLE;
  }

  // Spec: compute_safety_threshold(store, block_root, balance_source)
  // Build the threshold from the same terms used in the paper/spec:
  // max possible committee support, proposer boost, empty-slot discount, and adversarial budget.
  const proposerScore = computeProposerScore(ctx, balanceSource, cache);
  const maximumSupport = computeCommitteeWeightBetweenSlots(
    ctx,
    store,
    cache,
    balanceSource,
    (parentBlock.slot + 1) as Slot,
    (currentSlot - 1) as Slot
  );
  const supportDiscount = computeEmptySlotSupportDiscount(ctx, store, cache, balanceSource, blockRoot);
  const adversarialWeight = getAdversarialWeight(ctx, store, cache, balanceSource, blockRoot);

  // The discounted votes come from committees within the maximum support range and are weighed with
  // the same balances, so exceeding it means the computation is wrong rather than an underflow to guard.
  if (supportDiscount > maximumSupport) {
    throw new Error(`Fast confirmation support discount ${supportDiscount} exceeds maximum support ${maximumSupport}`);
  }
  const threshold = Math.floor((maximumSupport + proposerScore + 2 * adversarialWeight - supportDiscount) / 2);

  return {threshold, proposerScore, maximumSupport, supportDiscount, adversarialWeight};
}

export function isOneConfirmed(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  balanceSource: FastConfirmationBalanceSource,
  blockRoot: RootHex,
  sourceKey: BalanceSourceKey,
  logger?: Logger
): boolean {
  const currentSlot = ctx.getCurrentSlot();
  if (currentSlot === 0) return false;
  const block = getBlock(ctx, cache, blockRoot);
  if (!block) return false;
  if (block.executionStatus !== ExecutionStatus.Valid && block.executionStatus !== ExecutionStatus.PreMerge) {
    return false;
  }

  // Spec: is_one_confirmed(store, balance_source, block_root)
  // Compare actual support for this block against the computed LMD-GHOST safety threshold.
  const support = getAttestationScore(ctx, cache, balanceSource, blockRoot, sourceKey);
  const {threshold, proposerScore, maximumSupport, supportDiscount, adversarialWeight} = computeSafetyThreshold(
    ctx,
    store,
    cache,
    balanceSource,
    blockRoot
  );
  const isConfirmed = support > threshold;
  logger?.debug("Fast confirmation one-confirmed evaluation", {
    blockRoot,
    blockSlot: block.slot,
    currentSlot,
    sourceKey,
    support,
    threshold,
    proposerScore,
    maximumSupport,
    supportDiscount,
    adversarialWeight,
    isConfirmed,
  });

  return isConfirmed;
}

export function getCurrentTarget(ctx: FastConfirmationContext): CheckpointWithHex | null {
  const head = ctx.getHead().blockRoot;
  const currentEpoch = computeEpochAtSlot(ctx.getCurrentSlot());
  return getCheckpointForBlock(ctx, head, currentEpoch);
}

export function getCurrentEpochState(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): IBeaconStateView | null {
  return getPulledUpHeadState(ctx, store, cache);
}

export function getCurrentTargetScore(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): number {
  const target = getCurrentTarget(ctx);
  const targetState = getCurrentEpochState(ctx, store, cache);
  if (!target || !targetState) return 0;
  const balances = getZeroInactiveBalances({state: targetState, balances: targetState.effectiveBalanceIncrements});
  const activeIndices = targetState.getCurrentShuffling().activeIndices;
  const equivocating = ctx.getEquivocatingIndices();

  // Group validators by (voteRoot, voteEpoch) to avoid per-validator getCheckpointForBlock calls.
  // On mainnet ~1M validators vote for only ~50 unique (root, epoch) pairs.
  const voteGroups = new Map<RootHex, Map<Epoch, number>>();
  for (const i of activeIndices) {
    if (equivocating.has(i)) continue;
    const msg = ctx.getLatestMessage(i);
    if (!msg) continue;
    const weight = balances[i] ?? 0;
    if (weight === 0) continue;
    let byEpoch = voteGroups.get(msg.root);
    if (!byEpoch) {
      byEpoch = new Map();
      voteGroups.set(msg.root, byEpoch);
    }
    byEpoch.set(msg.epoch, (byEpoch.get(msg.epoch) ?? 0) + weight);
  }

  // Check each unique vote group's checkpoint against the target
  let score = 0;
  for (const [root, byEpoch] of voteGroups) {
    for (const [epoch, weight] of byEpoch) {
      const cp = getCheckpointForBlock(ctx, root, epoch);
      if (cp && cp.epoch === target.epoch && cp.rootHex === target.rootHex) {
        score += weight;
      }
    }
  }
  return score;
}

function computeHonestFfgSupport(
  totalActiveBalance: number,
  ffgSupport: number,
  ffgWeightTillNow: number,
  adversarialWeight: number,
  byzantineThreshold: number
): number {
  const remainingFfgWeight = totalActiveBalance - ffgWeightTillNow;
  // The spec rounds in raw Gwei as `remaining_ffg_weight // 100 * honest_percent`.
  // In Lodestar this value is in effective-balance increments, so multiply before dividing by 100
  // to preserve the same percentage semantics at our coarser unit scale.
  const remainingHonestFfgWeight = Math.floor((remainingFfgWeight * (100 - byzantineThreshold)) / 100);
  const minHonestFfgSupport = ffgSupport - Math.min(adversarialWeight, ffgSupport);
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
  const targetState = getCurrentEpochState(ctx, store, cache);
  if (!targetState) return 0;
  const targetBalanceSource = {state: targetState, balances: targetState.effectiveBalanceIncrements};
  const totalActiveBalance = getTotalActiveBalance(targetBalanceSource, cache);
  const ffgSupport = getCurrentTargetScore(ctx, store, cache);
  const tillNowFFGWeight = computeCommitteeWeightBetweenSlots(
    ctx,
    store,
    cache,
    targetBalanceSource,
    computeStartSlotAtEpoch(currentEpoch),
    (currentSlot - 1) as Slot
  );
  const adversarialWeight = computeAdversarialWeight(
    ctx,
    store,
    cache,
    {state: targetState, balances: targetState.effectiveBalanceIncrements},
    computeStartSlotAtEpoch(currentEpoch),
    (currentSlot - 1) as Slot
  );
  return computeHonestFfgSupport(
    totalActiveBalance,
    ffgSupport,
    tillNowFFGWeight,
    adversarialWeight,
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
  const targetState = getCurrentEpochState(ctx, store, cache);
  if (!targetState) return false;
  const totalActiveBalance = getTotalActiveBalance(
    {state: targetState, balances: targetState.effectiveBalanceIncrements},
    cache
  );
  const honestSupport = computeHonestFfgSupportForCurrentTarget(ctx, store, cache);
  return 3 * honestSupport > 1 * totalActiveBalance;
}

export function willCurrentTargetBeJustified(
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache
): boolean {
  const targetState = getCurrentEpochState(ctx, store, cache);
  if (!targetState) return false;
  const totalActiveBalance = getTotalActiveBalance(
    {state: targetState, balances: targetState.effectiveBalanceIncrements},
    cache
  );
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
  const checkpointInConfirmedChain = getCheckpointForBlock(
    ctx,
    confirmedRoot,
    store.currentEpochObservedJustifiedCheckpoint.epoch
  );
  if (
    checkpointInConfirmedChain === null ||
    !equalCheckpointWithHex(store.currentEpochObservedJustifiedCheckpoint, checkpointInConfirmedChain)
  ) {
    logger?.debug("Fast confirmation chain-safety failed", {
      confirmedRoot,
      reason: "observed_justified_checkpoint_not_in_confirmed_chain",
      observedJustifiedRoot: store.currentEpochObservedJustifiedCheckpoint.rootHex,
      observedJustifiedEpoch: store.currentEpochObservedJustifiedCheckpoint.epoch,
      checkpointRoot: checkpointInConfirmedChain?.rootHex,
      checkpointEpoch: checkpointInConfirmedChain?.epoch,
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
    if (!isOneConfirmed(ctx, store, cache, previousBalanceSource, root, "previous", logger)) {
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

// Spec: `find_latest_confirmed_descendant`
// https://github.com/ethereum/consensus-specs/blob/master/specs/phase0/fast-confirmation.md#find_latest_confirmed_descendant
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
  const shouldAdvanceThroughPreviousEpoch =
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
    shouldAdvanceThroughPreviousEpoch,
  });

  if (shouldAdvanceThroughPreviousEpoch) {
    const canonicalRoots = getAncestorRoots(ctx, cache, snapshot.headRoot, confirmedRoot);
    for (const blockRoot of canonicalRoots) {
      const block = getBlock(ctx, cache, blockRoot);
      const blockEpoch = block ? computeEpochAtSlot(block.slot) : null;
      const blockSlot = block?.slot;

      if (blockEpoch === null || blockEpoch === currentEpoch) {
        logger?.debug("Fast confirmation previous-epoch loop stopped", {
          reason: "reached_current_epoch_or_unknown_epoch",
          blockRoot,
          blockSlot,
          blockEpoch,
        });
        break;
      }
      if (!isAncestor(ctx, cache, store.previousSlotHead, blockRoot)) {
        logger?.debug("Fast confirmation previous-epoch loop stopped", {
          reason: "not_ancestor_of_previous_slot_head",
          blockRoot,
          blockSlot,
          blockEpoch,
          previousSlotHead: store.previousSlotHead,
        });
        break;
      }
      const isConfirmed = isOneConfirmed(ctx, store, cache, currentBalanceSource, blockRoot, "current", logger);
      if (!isConfirmed) {
        logger?.debug("Fast confirmation previous-epoch loop stopped", {
          reason: "block_not_one_confirmed",
          blockRoot,
          blockSlot,
          blockEpoch,
        });
        break;
      }
      confirmedRoot = blockRoot;
      logger?.debug("Fast confirmation previous-epoch loop advanced", {confirmedRoot});
    }
  }

  const shouldAdvanceThroughCurrentEpoch =
    isStartSlotOfEpoch(snapshot.currentSlot) ||
    (headJustification !== null && headJustification.epoch + 1 >= currentEpoch);

  if (shouldAdvanceThroughCurrentEpoch) {
    const canonicalRoots = getAncestorRoots(ctx, cache, snapshot.headRoot, confirmedRoot);
    let tentativeConfirmedRoot = confirmedRoot;

    for (const blockRoot of canonicalRoots) {
      const block = getBlock(ctx, cache, blockRoot);
      const blockEpoch = block ? computeEpochAtSlot(block.slot) : null;
      const blockSlot = block?.slot;
      const tentativeBlock = getBlock(ctx, cache, tentativeConfirmedRoot);
      const tentativeEpoch = tentativeBlock ? computeEpochAtSlot(tentativeBlock.slot) : null;
      if (blockEpoch === null || tentativeEpoch === null) break;

      if (blockEpoch > tentativeEpoch && !willCurrentTargetBeJustified(ctx, store, cache)) {
        logger?.debug("Fast confirmation current-epoch loop stopped", {
          reason: "current_target_not_justified",
          blockRoot,
          blockSlot,
          blockEpoch,
          tentativeEpoch,
        });
        break;
      }

      const isConfirmed = isOneConfirmed(ctx, store, cache, currentBalanceSource, blockRoot, "current", logger);
      if (!isConfirmed) {
        logger?.debug("Fast confirmation current-epoch loop stopped", {
          reason: "block_not_one_confirmed",
          blockRoot,
          blockSlot,
          blockEpoch,
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
    shouldAdvanceThroughCurrentEpoch,
  });

  return confirmedRoot;
}
