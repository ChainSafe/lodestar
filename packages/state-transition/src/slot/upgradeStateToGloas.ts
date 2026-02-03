import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {isValidDepositSignature} from "../block/processDeposit.js";
import {applyDepositForBuilder} from "../block/processDepositRequest.js";
import {getCachedBeaconState} from "../cache/stateCache.js";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {isBuilderWithdrawalCredential} from "../util/gloas.js";

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

  // Process pending builder deposits at the fork boundary
  onboardBuildersFromPendingDeposits(stateGloas);

  stateGloas.commit();
  // Clear cache to ensure the cache of fulu fields is not used by new gloas fields
  // biome-ignore lint/complexity/useLiteralKeys: It is a protected attribute
  stateGloas["clearCache"]();

  return stateGloas;
}

/**
 * Applies any pending deposit for builders, effectively onboarding builders at the fork.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.2/specs/gloas/fork.md#onboard_builders_from_pending_deposits
 */
function onboardBuildersFromPendingDeposits(state: CachedBeaconStateGloas): void {
  // Build set of validator pubkeys (mutable - new valid deposits add to this)
  const validatorPubkeys = new Set<string>();
  for (let i = 0; i < state.validators.length; i++) {
    validatorPubkeys.add(toHex(state.validators.getReadonly(i).pubkey));
  }

  const pendingDeposits: {
    pubkey: Uint8Array;
    withdrawalCredentials: Uint8Array;
    amount: number;
    signature: Uint8Array;
    slot: number;
  }[] = [];

  const numDeposits = state.pendingDeposits.length;

  for (let idx = 0; idx < numDeposits; idx++) {
    const deposit = state.pendingDeposits.getReadonly(idx);
    const pubkeyHex = toHex(deposit.pubkey);

    // Deposits for existing validators stay in pending queue
    if (validatorPubkeys.has(pubkeyHex)) {
      pendingDeposits.push({
        pubkey: deposit.pubkey,
        withdrawalCredentials: deposit.withdrawalCredentials,
        amount: deposit.amount,
        signature: deposit.signature,
        slot: deposit.slot,
      });
      continue;
    }

    // Check if pubkey is associated with a builder (recompute each iteration as
    // apply_deposit_for_builder may add builders to the registry)
    let isExistingBuilder = false;
    for (let i = 0; i < state.builders.length; i++) {
      if (toHex(state.builders.getReadonly(i).pubkey) === pubkeyHex) {
        isExistingBuilder = true;
        break;
      }
    }

    const hasBuilderCredentials = isBuilderWithdrawalCredential(deposit.withdrawalCredentials);

    if (isExistingBuilder || hasBuilderCredentials) {
      // Apply deposit to new/existing builder
      applyDepositForBuilder(
        state,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        deposit.signature,
        deposit.slot
      );
      continue;
    }

    // If pending deposit for a new validator with valid signature, track the pubkey
    // so subsequent builder deposits for the same pubkey stay in pending (applied
    // to the validator later). Deposits with invalid signatures are dropped.
    if (
      isValidDepositSignature(
        state.config,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        deposit.signature
      )
    ) {
      validatorPubkeys.add(pubkeyHex);
      pendingDeposits.push({
        pubkey: deposit.pubkey,
        withdrawalCredentials: deposit.withdrawalCredentials,
        amount: deposit.amount,
        signature: deposit.signature,
        slot: deposit.slot,
      });
    }
  }

  // Replace pending deposits with filtered list
  state.pendingDeposits = ssz.electra.PendingDeposits.toViewDU(
    pendingDeposits.map((d) => ({
      pubkey: d.pubkey,
      withdrawalCredentials: d.withdrawalCredentials,
      amount: d.amount,
      signature: d.signature,
      slot: d.slot,
    }))
  );
}
