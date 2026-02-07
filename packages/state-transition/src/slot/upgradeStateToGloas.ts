import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {isValidDepositSignature} from "../block/processDeposit.js";
import {applyDepositForBuilder} from "../block/processDepositRequest.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {isBuilderWithdrawalCredential} from "../util/gloas.js";
import {isValidatorKnown} from "../util/index.js";

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

  for (let i = 0; i < SLOTS_PER_HISTORICAL_ROOT; i++) {
    stateGloasView.executionPayloadAvailability.set(i, true);
  }
  stateGloasView.latestBlockHash = stateFulu.latestExecutionPayloadHeader.blockHash;

  const stateGloas = getCachedBeaconState(stateGloasView, stateFulu);

  // Applies any pending deposits for builders, effectively onboarding builders at the fork.
  // Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.2/specs/gloas/fork.md#new-onboard_builders_from_pending_deposits
  onboardBuildersFromPendingDeposits(stateGloas);

  stateGloas.commit();
  // Clear cache to ensure the cache of fulu fields is not used by new gloas fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateGloas["clearCache"]();

  return stateGloas;
}

function onboardBuildersFromPendingDeposits(state: CachedBeaconStateGloas): void {
  const trackedValidatorPubkeys = new Set<string>();

  // Pre-compute builder pubkeys set for O(1) lookup instead of O(n) per deposit
  const builderPubkeys = new Set<string>();
  for (let i = 0; i < state.builders.length; i++) {
    builderPubkeys.add(toHex(state.builders.getReadonly(i).pubkey));
  }

  const remainingPendingDeposits = state.pendingDeposits.sliceFrom(state.pendingDeposits.length);
  for (let i = 0; i < state.pendingDeposits.length; i++) {
    const deposit = state.pendingDeposits.getReadonly(i);

    const validatorIndex = state.epochCtx.getValidatorIndex(deposit.pubkey);
    const pubkeyHex = toHex(deposit.pubkey);

    // Deposits for existing validators stay in pending queue
    if (isValidatorKnown(state, validatorIndex) || trackedValidatorPubkeys.has(pubkeyHex)) {
      remainingPendingDeposits.push(deposit);
      continue;
    }

    // If deposit is for an existing builder or has builder credentials, apply it
    const isExistingBuilder = builderPubkeys.has(pubkeyHex);
    const hasBuilderCredentials = isBuilderWithdrawalCredential(deposit.withdrawalCredentials);
    if (isExistingBuilder || hasBuilderCredentials) {
      applyDepositForBuilder(
        state,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        deposit.signature,
        deposit.slot
      );
      // Track newly added builder pubkeys for subsequent deposits
      builderPubkeys.add(pubkeyHex);
      continue;
    }

    // Track new validator pubkeys with valid signatures so subsequent deposits don't create a builder
    // Deposits with invalid signatures are dropped here since they would fail in apply_pending_deposit anyway.
    if (
      isValidDepositSignature(
        state.config,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        deposit.signature
      )
    ) {
      trackedValidatorPubkeys.add(pubkeyHex);
      remainingPendingDeposits.push(deposit);
    }
  }

  state.pendingDeposits = remainingPendingDeposits;
}
