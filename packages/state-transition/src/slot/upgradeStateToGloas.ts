import {getNodesAtDepth} from "@chainsafe/persistent-merkle-tree";
import {
  BasicType,
  CompositeType,
  CompositeView,
  CompositeViewDU,
  ListBasicTreeViewDU,
  ListCompositeTreeViewDU,
  ProgressiveListBasicType,
  ProgressiveListCompositeType,
  ValueOf,
} from "@chainsafe/ssz";
import {PAYLOAD_BUILDER_VERSION, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {isValidDepositSignature} from "../block/processDeposit.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {addBuilderToRegistry, initializePtcWindow, isBuilderWithdrawalCredential} from "../util/gloas.js";
import {isValidatorKnown} from "../util/index.js";
import {PendingDepositsLookup} from "../util/pendingDepositsLookup.js";
import {progressiveListRootNode} from "../util/ssz.js";

/**
 * Upgrade a state from Fulu to Gloas.
 */
export function upgradeStateToGloas(stateFulu: CachedBeaconStateFulu): CachedBeaconStateGloas {
  const {config} = stateFulu;

  ssz.fulu.BeaconState.commitViewDU(stateFulu);
  const stateGloasCloned = stateFulu;

  const stateGloasView = ssz.gloas.BeaconState.defaultViewDU();

  stateGloasView.genesisTime = stateGloasCloned.genesisTime;
  stateGloasView.genesisValidatorsRoot = stateGloasCloned.genesisValidatorsRoot;
  stateGloasView.slot = stateGloasCloned.slot;
  stateGloasView.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: stateFulu.fork.currentVersion,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: stateFulu.epochCtx.epoch,
  });
  stateGloasView.latestBlockHeader = stateGloasCloned.latestBlockHeader;
  stateGloasView.blockRoots = stateGloasCloned.blockRoots;
  stateGloasView.stateRoots = stateGloasCloned.stateRoots;
  stateGloasView.historicalRoots = stateGloasCloned.historicalRoots;
  stateGloasView.eth1Data = stateGloasCloned.eth1Data;
  stateGloasView.eth1DataVotes = stateGloasCloned.eth1DataVotes;
  stateGloasView.eth1DepositIndex = stateGloasCloned.eth1DepositIndex;
  stateGloasView.validators = migrateCompositeListToGloas(stateGloasCloned.validators, ssz.gloas.Validators);
  stateGloasView.balances = migrateBasicListToGloas(stateGloasCloned.balances, ssz.gloas.Balances);
  stateGloasView.randaoMixes = stateGloasCloned.randaoMixes;
  stateGloasView.slashings = stateGloasCloned.slashings;
  stateGloasView.previousEpochParticipation = migrateBasicListToGloas(
    stateGloasCloned.previousEpochParticipation,
    ssz.gloas.EpochParticipation
  );
  stateGloasView.currentEpochParticipation = migrateBasicListToGloas(
    stateGloasCloned.currentEpochParticipation,
    ssz.gloas.EpochParticipation
  );
  stateGloasView.justificationBits = stateGloasCloned.justificationBits;
  stateGloasView.previousJustifiedCheckpoint = stateGloasCloned.previousJustifiedCheckpoint;
  stateGloasView.currentJustifiedCheckpoint = stateGloasCloned.currentJustifiedCheckpoint;
  stateGloasView.finalizedCheckpoint = stateGloasCloned.finalizedCheckpoint;
  stateGloasView.inactivityScores = migrateBasicListToGloas(
    stateGloasCloned.inactivityScores,
    ssz.gloas.InactivityScores
  );
  stateGloasView.currentSyncCommittee = stateGloasCloned.currentSyncCommittee;
  stateGloasView.nextSyncCommittee = stateGloasCloned.nextSyncCommittee;
  stateGloasView.latestExecutionPayloadBid.blockHash = stateFulu.latestExecutionPayloadHeader.blockHash;
  stateGloasView.latestExecutionPayloadBid.gasLimit = BigInt(stateFulu.latestExecutionPayloadHeader.gasLimit);
  stateGloasView.latestExecutionPayloadBid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(
    ssz.gloas.ExecutionRequests.defaultValue()
  );
  stateGloasView.nextWithdrawalIndex = stateGloasCloned.nextWithdrawalIndex;
  stateGloasView.nextWithdrawalValidatorIndex = stateGloasCloned.nextWithdrawalValidatorIndex;
  stateGloasView.historicalSummaries = stateGloasCloned.historicalSummaries;
  stateGloasView.depositRequestsStartIndex = stateGloasCloned.depositRequestsStartIndex;
  stateGloasView.depositBalanceToConsume = stateGloasCloned.depositBalanceToConsume;
  stateGloasView.exitBalanceToConsume = stateGloasCloned.exitBalanceToConsume;
  stateGloasView.earliestExitEpoch = stateGloasCloned.earliestExitEpoch;
  stateGloasView.consolidationBalanceToConsume = stateGloasCloned.consolidationBalanceToConsume;
  stateGloasView.earliestConsolidationEpoch = stateGloasCloned.earliestConsolidationEpoch;
  stateGloasView.pendingDeposits = migrateCompositeListToGloas(
    stateGloasCloned.pendingDeposits,
    ssz.gloas.PendingDeposits
  );
  stateGloasView.pendingPartialWithdrawals = migrateCompositeListToGloas(
    stateGloasCloned.pendingPartialWithdrawals,
    ssz.gloas.PendingPartialWithdrawals
  );
  stateGloasView.pendingConsolidations = migrateCompositeListToGloas(
    stateGloasCloned.pendingConsolidations,
    ssz.gloas.PendingConsolidations
  );
  stateGloasView.proposerLookahead = stateGloasCloned.proposerLookahead;
  stateGloasView.ptcWindow = ssz.gloas.PtcWindow.toViewDU(initializePtcWindow(stateFulu));

  for (let i = 0; i < SLOTS_PER_HISTORICAL_ROOT; i++) {
    stateGloasView.executionPayloadAvailability.set(i, true);
  }
  stateGloasView.latestBlockHash = stateFulu.latestExecutionPayloadHeader.blockHash;

  const stateGloas = getCachedBeaconState(stateGloasView, stateFulu);

  // Process pending builder deposits at the fork boundary
  onboardBuildersFromPendingDeposits(stateGloas);

  stateGloas.commit();
  // Clear cache to ensure the cache of fulu fields is not used by new gloas fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateGloas["clearCache"]();

  return stateGloas;
}

/**
 * Migrate a composite list from fulu to its gloas progressive-list equivalent by reusing the fulu
 * list's element nodes.
 *
 * Works whenever the element type is identical across the fork (e.g. validators use ValidatorNodeStruct,
 * the pending* queues use the same electra element types). Each element's cached subtree root is then
 * valid under gloas, so only the progressive list superstructure is rebuilt and a subsequent
 * hashTreeRoot() skips re-hashing every element — the dominant cost for large lists like validators.
 * Much cheaper than `gloasType.toViewDU(fuluList.getAllReadonlyValues())`, which decodes every element
 * to a value and forces a full re-hash.
 *
 * The chunk nodes of a composite list ARE the element root nodes, so they are extracted directly
 * with getNodesAtDepth instead of allocating a temporary ViewDU wrapper per element (getAllReadonly).
 * Requires the fulu view to be committed (done at the top of upgradeStateToGloas).
 */
function migrateCompositeListToGloas<
  ElementType extends CompositeType<ValueOf<ElementType>, CompositeView<ElementType>, CompositeViewDU<ElementType>>,
>(fuluList: ListCompositeTreeViewDU<ElementType>, gloasType: ProgressiveListCompositeType<ElementType>) {
  const {length, type} = fuluList;
  const elementNodes = getNodesAtDepth(fuluList.node.left, type.chunkDepth, 0, length);
  return gloasType.getViewDU(progressiveListRootNode(elementNodes, length));
}

/**
 * Migrate a basic list from fulu to its gloas progressive-list equivalent by reusing the fulu
 * list's packed chunk leaf nodes.
 *
 * Packed leaf chunks are bit-identical between List[T, N] and ProgressiveList[T] (same 32-byte
 * LE packing, zero-padded final chunk); only the superstructure above the leaves differs. Reusing
 * the leaves avoids materializing the value array (getAll), re-serializing it, and allocating
 * fresh LeafNodes — the gloas tree shares the leaf nodes with the fulu tree.
 * Requires the fulu view to be committed (done at the top of upgradeStateToGloas).
 */
function migrateBasicListToGloas<ElementType extends BasicType<unknown>>(
  fuluList: ListBasicTreeViewDU<ElementType>,
  gloasType: ProgressiveListBasicType<ElementType>
) {
  const {length, type} = fuluList;
  const chunkCount = Math.ceil(length / type.itemsPerChunk);
  // List root = BranchNode(chunksNode, lengthNode) → chunks tree is the left child
  const chunkLeafNodes = getNodesAtDepth(fuluList.node.left, type.chunkDepth, 0, chunkCount);
  return gloasType.getViewDU(progressiveListRootNode(chunkLeafNodes, length));
}

/**
 * Applies any pending deposits for builders to onboard builders during the fork transition
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.8/specs/gloas/fork.md#new-onboard_builders_from_pending_deposits
 */
function onboardBuildersFromPendingDeposits(state: CachedBeaconStateGloas): void {
  // Track pubkeys of new builders added when applying deposits. `state.builders` starts empty
  // at the fork, so every builder pubkey here is one added in an earlier iteration.
  const builderPubkeys = new Set<string>();

  const pendingDeposits = ssz.gloas.PendingDeposits.defaultViewDU();
  const pendingDepositsLookup = PendingDepositsLookup.buildEmpty();

  for (let i = 0; i < state.pendingDeposits.length; i++) {
    const deposit = state.pendingDeposits.getReadonly(i);

    const validatorIndex = state.epochCtx.getValidatorIndex(deposit.pubkey);
    const pubkeyHex = toPubkeyHex(deposit.pubkey);

    // Deposits for existing validators stay in the pending queue
    if (isValidatorKnown(state, validatorIndex)) {
      pendingDeposits.push(deposit);
      pendingDepositsLookup.add(deposit, pubkeyHex);
      continue;
    }

    if (builderPubkeys.has(pubkeyHex)) {
      // Top up an already-onboarded builder
      // TODO GLOAS: linear search; consider builder pubkey cache when we drop the upgrade-time set
      for (let j = 0; j < state.builders.length; j++) {
        if (toPubkeyHex(state.builders.getReadonly(j).pubkey) === pubkeyHex) {
          state.builders.get(j).balance += deposit.amount;
          break;
        }
      }
      continue;
    }

    // Deposits for non-builders stay in the pending queue. If there is a valid pending
    // deposit for a new validator with this pubkey, keep this deposit pending so the validator
    // can pick it up later.
    if (!isBuilderWithdrawalCredential(deposit.withdrawalCredentials)) {
      pendingDeposits.push(deposit);
      pendingDepositsLookup.add(deposit, pubkeyHex);
      continue;
    }
    if (pendingDepositsLookup.hasPendingValidator(state.config, pubkeyHex)) {
      pendingDeposits.push(deposit);
      pendingDepositsLookup.add(deposit, pubkeyHex);
      continue;
    }

    // Verify the deposit signature (proof of possession). If invalid the deposit is silently
    // dropped — stake is forfeited, matching the validator deposit contract behavior.
    //
    // The prepareNextSlot scheduler pre-verifies these signatures in the epochs before the fork
    // A cache miss falls back to verifying this one deposit — no worse than pre-cache.
    const cached = state.epochCtx.builderDepositSignatureCache.getSignatureValidity(deposit.toValue());
    const isValid =
      cached ??
      isValidDepositSignature(
        state.config,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        deposit.signature
      );
    if (!isValid) {
      continue;
    }

    addBuilderToRegistry(
      state,
      deposit.pubkey,
      PAYLOAD_BUILDER_VERSION,
      deposit.withdrawalCredentials.subarray(12),
      deposit.amount,
      deposit.slot
    );
    builderPubkeys.add(pubkeyHex);
  }

  state.pendingDeposits = pendingDeposits;
}
