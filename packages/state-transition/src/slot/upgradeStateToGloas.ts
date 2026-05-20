import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {applyDepositForBuilder} from "../block/processDepositRequest.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {initializePtcWindow, isBuilderWithdrawalCredential} from "../util/gloas.js";
import {isValidatorKnown} from "../util/index.js";
import {PendingDepositsLookup} from "../util/pendingDepositsLookup.js";

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
  stateGloasView.validators = ssz.gloas.Validators.toViewDU(stateGloasCloned.validators.getAllReadonlyValues());
  stateGloasView.balances = ssz.gloas.Balances.toViewDU(stateGloasCloned.balances.getAll());
  stateGloasView.randaoMixes = stateGloasCloned.randaoMixes;
  stateGloasView.slashings = stateGloasCloned.slashings;
  stateGloasView.previousEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
    stateGloasCloned.previousEpochParticipation.getAll()
  );
  stateGloasView.currentEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
    stateGloasCloned.currentEpochParticipation.getAll()
  );
  stateGloasView.justificationBits = stateGloasCloned.justificationBits;
  stateGloasView.previousJustifiedCheckpoint = stateGloasCloned.previousJustifiedCheckpoint;
  stateGloasView.currentJustifiedCheckpoint = stateGloasCloned.currentJustifiedCheckpoint;
  stateGloasView.finalizedCheckpoint = stateGloasCloned.finalizedCheckpoint;
  stateGloasView.inactivityScores = ssz.gloas.InactivityScores.toViewDU(stateGloasCloned.inactivityScores.getAll());
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
  stateGloasView.pendingDeposits = ssz.gloas.PendingDeposits.toViewDU(
    stateGloasCloned.pendingDeposits.getAllReadonlyValues()
  );
  stateGloasView.pendingPartialWithdrawals = ssz.gloas.PendingPartialWithdrawals.toViewDU(
    stateGloasCloned.pendingPartialWithdrawals.getAllReadonlyValues()
  );
  stateGloasView.pendingConsolidations = ssz.gloas.PendingConsolidations.toViewDU(
    stateGloasCloned.pendingConsolidations.getAllReadonlyValues()
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
 * Applies any pending deposits for builders to onboard builders during the fork transition
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.8/specs/gloas/fork.md#new-onboard_builders_from_pending_deposits
 */
function onboardBuildersFromPendingDeposits(state: CachedBeaconStateGloas): void {
  // Track pubkeys of new builders added when applying deposits
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

    // `applyDepositForBuilder` can mutate the state and add a builder to the registry, so
    // the set of builder pubkeys must be recomputed each iteration. `builderPubkeys` stands
    // in for the spec's `[b.pubkey for b in state.builders]`: `state.builders` starts empty
    // at the fork, so every builder is one added in a previous iteration of this loop.
    if (!builderPubkeys.has(pubkeyHex)) {
      // Deposits for non-builders stay in the pending queue. If there is a valid pending
      // deposit for a new validator with this pubkey, keep this deposit in the pending
      // queue to be applied to that validator later.
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
    }

    const buildersLenBefore = state.builders.length;
    // TODO GLOAS: handle 20k 1ETH deposits on time
    // there is a note in the spec https://github.com/ethereum/consensus-specs/pull/5227
    applyDepositForBuilder(
      state,
      deposit.pubkey,
      deposit.withdrawalCredentials,
      deposit.amount,
      deposit.signature,
      deposit.slot
    );
    if (state.builders.length > buildersLenBefore) {
      builderPubkeys.add(pubkeyHex);
    }
  }

  state.pendingDeposits = pendingDeposits;
}
