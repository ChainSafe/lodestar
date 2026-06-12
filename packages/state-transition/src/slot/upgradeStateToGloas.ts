import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {isValidDepositSignature} from "../block/processDeposit.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {addBuilderToRegistry, initializePtcWindow, isBuilderWithdrawalCredential} from "../util/gloas.js";
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
  stateGloasView.validators = stateGloasCloned.validators;
  stateGloasView.balances = stateGloasCloned.balances;
  stateGloasView.randaoMixes = stateGloasCloned.randaoMixes;
  stateGloasView.slashings = stateGloasCloned.slashings;
  stateGloasView.previousEpochParticipation = stateGloasCloned.previousEpochParticipation;
  stateGloasView.currentEpochParticipation = stateGloasCloned.currentEpochParticipation;
  stateGloasView.justificationBits = stateGloasCloned.justificationBits;
  stateGloasView.previousJustifiedCheckpoint = stateGloasCloned.previousJustifiedCheckpoint;
  stateGloasView.currentJustifiedCheckpoint = stateGloasCloned.currentJustifiedCheckpoint;
  stateGloasView.finalizedCheckpoint = stateGloasCloned.finalizedCheckpoint;
  stateGloasView.inactivityScores = stateGloasCloned.inactivityScores;
  stateGloasView.currentSyncCommittee = stateGloasCloned.currentSyncCommittee;
  stateGloasView.nextSyncCommittee = stateGloasCloned.nextSyncCommittee;
  stateGloasView.latestExecutionPayloadBid.blockHash = stateFulu.latestExecutionPayloadHeader.blockHash;
  stateGloasView.latestExecutionPayloadBid.gasLimit = BigInt(stateFulu.latestExecutionPayloadHeader.gasLimit);
  stateGloasView.latestExecutionPayloadBid.executionRequestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(
    ssz.electra.ExecutionRequests.defaultValue()
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
  stateGloasView.pendingDeposits = stateGloasCloned.pendingDeposits;
  stateGloasView.pendingPartialWithdrawals = stateGloasCloned.pendingPartialWithdrawals;
  stateGloasView.pendingConsolidations = stateGloasCloned.pendingConsolidations;
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
  // Track pubkeys of new builders added when applying deposits. `state.builders` starts empty
  // at the fork, so every builder pubkey here is one added in an earlier iteration.
  const builderPubkeys = new Set<string>();

  const pendingDeposits = ssz.electra.PendingDeposits.defaultViewDU();
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
    if (
      !isValidDepositSignature(
        state.config,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        deposit.signature
      )
    ) {
      continue;
    }

    addBuilderToRegistry(
      state,
      deposit.pubkey,
      deposit.withdrawalCredentials[0],
      deposit.withdrawalCredentials.subarray(12),
      deposit.amount,
      deposit.slot
    );
    builderPubkeys.add(pubkeyHex);
  }

  state.pendingDeposits = pendingDeposits;
}
