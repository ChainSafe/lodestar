import BN from "bn.js";
import assert from "assert";
import {
  Attestation,
  BeaconState, Epoch, Gwei, PendingAttestation, Shard, Validator, ValidatorIndex,
} from "../../../types";
import {
  ACTIVATION_EXIT_DELAY,
  ATTESTATION_INCLUSION_REWARD_QUOTIENT,
  BASE_REWARD_QUOTIENT, EJECTION_BALANCE, EPOCHS_PER_ETH1_VOTING_PERIOD, INACTIVITY_PENALTY_QUOTIENT, INITIATED_EXIT,
  LATEST_ACTIVE_INDEX_ROOTS_LENGTH, LATEST_RANDAO_MIXES_LENGTH, LATEST_SLASHED_EXIT_LENGTH,
  MAX_BALANCE_CHURN_QUOTIENT,
  MAX_DEPOSIT_AMOUNT,
  MIN_ATTESTATION_INCLUSION_DELAY, SHARD_COUNT,
  SLOTS_PER_EPOCH
} from "../../../constants";
import {
  generateSeed,
  getActiveValidatorIndices, getBeaconProposerIndex, getBlockRoot, getCurrentEpoch, getCurrentEpochCommitteeCount,
  getEffectiveBalance,
  getEntryExitEffectEpoch,
  getEpochStartSlot, getPreviousEpoch,
  getPreviousEpochCommitteeCount, getRandaoMix, getTotalBalance, intSqrt, isActiveValidator, isPowerOfTwo, slotToEpoch
} from "../../../helpers/stateTransitionHelpers";
import {typeIsOrHasBaseType} from "tslint/lib/language/typeUtils";
import {activateValidator, hashTreeRoot} from "../../state";
import {processRewardsAndPenalties} from "./balanceUpdates";
import {processEth1Data} from "./eth1data";
import {processValidatorRegistryAndShuffleSeedData} from "./shuffling";
import {processEjections} from "./helpers";
import {processFinalUpdates} from "./finalUpdates";
import {processCrosslinks} from "./crosslinks";
import {processJustification} from "./justification";
import {processVariables} from "./variables";

export function processEpoch(state: BeaconState): BeaconState {
  assert(state.slot.addn(1).modn(SLOTS_PER_EPOCH) === 0);

  // Variables
  const {
    currentEpoch,
    previousEpoch,
    nextEpoch,
    currentTotalBalance,
    currentEpochAttestations,
    currentEpochBoundaryAttesterIndices,
    currentEpochBoundaryAttestingBalance,
    previousTotalBalance,
    previousEpochAttestations,
    previousEpochAttesterIndices,
    previousEpochAttestingBalance,
    previousEpochBoundaryAttestations,
    previousEpochBoundaryAttesterIndices,
    previousEpochBoundaryAttestingBalance,
    previousEpochHeadAttestations,
    previousEpochHeadAttesterIndices,
    previousEpochHeadAttestingBalance,
  } = processVariables(state);

  // TODO below
  // For every slot in range(get_epoch_start_slot(previous_epoch), get_epoch_start_slot(next_epoch)), let crosslink_committees_at_slot = get_crosslink_committees_at_slot(state, slot). For every (crosslink_committee, shard) in crosslink_committees_at_slot, compute:
  //
  // Let shard_block_root be state.latest_crosslinks[shard].shard_block_root
  // Let attesting_validator_indices(crosslink_committee, shard_block_root) be the union of the validator index sets given by [get_attestation_participants(state, a.data, a.aggregation_bitfield) for a in current_epoch_attestations + previous_epoch_attestations if a.data.shard == shard and a.data.shard_block_root == shard_block_root].
  // Let winning_root(crosslink_committee) be equal to the value of shard_block_root such that get_total_balance(state, attesting_validator_indices(crosslink_committee, shard_block_root)) is maximized (ties broken by favoring lower shard_block_root values).
  // Let attesting_validators(crosslink_committee) be equal to attesting_validator_indices(crosslink_committee, winning_root(crosslink_committee)) for convenience.
  //
  // Define the following helpers to process attestation inclusion rewards and inclusion distance reward/penalty. For every attestation a in previous_epoch_attestations:
  //
  // Let inclusion_slot(state, index) = a.inclusion_slot for the attestation a where index is in get_attestation_participants(state, a.data, a.aggregation_bitfield). If multiple attestations are applicable, the attestation with lowest inclusion_slot is considered.
  // Let inclusion_distance(state, index) = a.inclusion_slot - a.data.slot where a is the above attestation.

  // Eth1 Data
  // TODO FINISH
  processEth1Data(state);

  // Justification
  processJustification(
    state,
    currentEpoch,
    previousEpoch,
    previousEpochBoundaryAttestingBalance,
    currentEpochBoundaryAttestingBalance,
    currentTotalBalance,
    previousTotalBalance
  );

  // Crosslinks
  processCrosslinks(state);

  // Rewards and penalties helpers
  const baseRewardQuotient = previousTotalBalance.sqr().divn(BASE_REWARD_QUOTIENT);
  const baseReward = (state: BeaconState, index: ValidatorIndex) => getEffectiveBalance(state, index).div(baseRewardQuotient).divn(5);
  const inactivityPenalty = (state: BeaconState, index: ValidatorIndex, epochsSinceFinality: Epoch): BN => {
    return baseReward(state, index)
      .add(getEffectiveBalance(state, index))
      .mul(epochsSinceFinality)
      .divn(INACTIVITY_PENALTY_QUOTIENT)
      .divn(2);
  };

  // Process Rewards and penalties
  processRewardsAndPenalties(
    state,
    currentEpoch,
    previousEpoch,
    nextEpoch,
    previousTotalBalance,
    previousEpochAttesterIndices,
    previousEpochBoundaryAttesterIndices,
    previousEpochHeadAttesterIndices,
    previousEpochAttestingBalance,
    previousEpochBoundaryAttestingBalance,
    previousEpochHeadAttestingBalance,
    baseReward,
    inactivityPenalty,
  );

  // Ejections
  processEjections(state);

  // Validator Registry and shuffling seed data
  processValidatorRegistryAndShuffleSeedData(state, currentEpoch, nextEpoch);

  // Final Updates
  processFinalUpdates(state, currentEpoch, nextEpoch);

  // assert(block.stateRoot ==== hashTreeRoot(state))
  return state;
}
