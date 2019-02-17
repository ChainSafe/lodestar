import BN from "bn.js";
import assert from "assert";
import {
  Attestation,
  BeaconState, Epoch, Gwei, PendingAttestation, Validator, ValidatorIndex,
} from "../types";
import {
  ACTIVATION_EXIT_DELAY,
  ATTESTATION_INCLUSION_REWARD_QUOTIENT,
  BASE_REWARD_QUOTIENT, EJECTION_BALANCE, EPOCHS_PER_ETH1_VOTING_PERIOD, INACTIVITY_PENALTY_QUOTIENT, INITIATED_EXIT,
  LATEST_ACTIVE_INDEX_ROOTS_LENGTH, LATEST_RANDAO_MIXES_LENGTH, LATEST_SLASHED_EXIT_LENGTH,
  MAX_BALANCE_CHURN_QUOTIENT,
  MAX_DEPOSIT_AMOUNT,
  MIN_ATTESTATION_INCLUSION_DELAY, SHARD_COUNT,
  SLOTS_PER_EPOCH
} from "../constants";
import {
  generateSeed,
  getActiveValidatorIndices, getBeaconProposerIndex, getBlockRoot, getCurrentEpoch, getCurrentEpochCommitteeCount,
  getEffectiveBalance,
  getEntryExitEffectEpoch,
  getEpochStartSlot, getPreviousEpoch,
  getPreviousEpochCommitteeCount, getRandaoMix, getTotalBalance, intSqrt, isActiveValidator, isPowerOfTwo, slotToEpoch
} from "../helpers/stateTransitionHelpers";
import {typeIsOrHasBaseType} from "tslint/lib/language/typeUtils";
import {activateValidator, hashTreeRoot} from "../helpers/validatorStatus";

export function processEpoch(state: BeaconState): BeaconState {
  // TODO probably move this to a HOF that checks for processing
  if (state.slot.addn(1).modn(SLOTS_PER_EPOCH) === 0) {
    const currentEpoch: Epoch = getCurrentEpoch(state);
    const previousEpoch: Epoch = getPreviousEpoch(state);
    const nextEpoch: Epoch = currentEpoch.addn(1);

    ///
    // Validators attesting during the current epoch TODO: This might need to be a switch case
    ///
    const currentTotalBalance: Gwei = getTotalBalance(state, getActiveValidatorIndices(state.validatorRegistry, currentEpoch));
    const currentEpochAttestations: PendingAttestation[] = state.latestAttestations.filter((attestation) => {
      if (currentEpoch === slotToEpoch(attestation.data.slot)) {
        return attestation;
      }
    });

    // Validators justifying the epoch boundary block at the start of the current epoch
    const currentEpochBoundaryAttestations: PendingAttestation[] = currentEpochAttestations.filter((attestation) => {
      if (attestation.data.epochBoundaryRoot === getBlockRoot(state, getEpochStartSlot(currentEpoch))) {
        return attestation;
      }
    });

    const currentEpochBoundaryAttesterIndices: ValidatorIndex[] = currentEpochAttestations.map((attestation) => {
      return getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield)
    });

    const currentEpochBoundaryAttestingBalance = getTotalBalance(state, currentEpochBoundaryAttesterIndices);

    ///
    // Validators attesting during the previous epoch TODO: This might need to be a switch case
    ///
    const previousTotalBalance = getTotalBalance(state, getActiveValidatorIndices(state.validatorRegistry, previousEpoch));

    // Validators that made an attestation during the previous epoch, targeting the previous justified slot
    const previousEpochAttestations: PendingAttestation[] = state.latestAttestations.filter((attestation) => {
      if (previousEpoch === slotToEpoch(attestation.data.slot)) {
        return attestation;
      }
    });

    const previousEpochAttesterIndices: ValidatorIndex[] = previousEpochAttestations.map((attestation) => {
      return getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield);
    });

    const previousEpochAttestingBalance: Gwei = getTotalBalance(state, previousEpochAttesterIndices);

    ///
    // Validators justifying the epoch boundary block at the start of the previous epoch TODO: This might need to be a switch case
    ///

    const previousEpochBoundaryAttestations: PendingAttestation[] = previousEpochAttestations.filter((attestation) => {
      if (attestation.data.epochBoundaryRoot === getBlockRoot(state, getEpochStartSlot(previousEpoch))) {
        return attestation;
      }
    });

    const previousEpochBoundaryAttesterIndices: ValidatorIndex[] = previousEpochBoundaryAttestations.map((attestation) => {
      return getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield)
    });

    const previousEpochBoundaryAttestingBalance: Gwei = getTotalBalance(state, previousEpochBoundaryAttesterIndices);

    ///
    // Validators attesting to the expected beacon chain head during the previous epoch TODO: This might need to be a switch case
    ///

    const previousEpochHeadAttestations: PendingAttestation[] = previousEpochAttestations.filter((attestation) => {
      if (attestation.data.beaconBlockRoot === getBlockRoot(state, attestation.data.slot)) {
        return attestation;
      }
    });

    const previousEpochHeadAttesterIndices: ValidatorIndex[] = previousEpochAttestations.map((attestation) => {
      return getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield)
    });

    const previousEpochHeadAttestingBalance: Gwei = getTotalBalance(state, previousEpochHeadAttesterIndices);

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

    // ETH1 Data
    // If next_epoch % EPOCHS_PER_ETH1_VOTING_PERIOD == 0:
    //
    // If eth1_data_vote.vote_count * 2 > EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH for some eth1_data_vote in state.eth1_data_votes (ie. more than half the votes in this voting period were for that value), set state.latest_eth1_data = eth1_data_vote.eth1_data.
    //   Set state.eth1_data_votes = [].
    // if (nextEpoch.mod(new BN(EPOCHS_PER_ETH1_VOTING_PERIOD)).eqn(0)) {
    //   if (state.eth1)
    // }

    ///
    // Justification
    ///
    let newJustifiedEpoch = state.justifiedEpoch;
    state.justificationBitfield = state.justificationBitfield.shln(1);
    state.justificationBitfield = state.justificationBitfield.or(new BN(2));
    if (previousEpochBoundaryAttestingBalance.muln(3) >= previousTotalBalance.muln(2)) {
      newJustifiedEpoch = previousEpoch
    }
    state.justificationBitfield = state.justificationBitfield.or(new BN(1));
    if (currentEpochBoundaryAttestingBalance.muln(3) >= currentTotalBalance.muln(2)) {
      newJustifiedEpoch = currentEpoch;
    }

    // Update last finalized epoch if possible
    if (state.justificationBitfield.shln(1).modn(8) === 0b111 && state.previousJustifiedEpoch === previousEpoch.subn(2)) {
      state.finalizedEpoch = state.previousJustifiedEpoch;
    }
    if (state.justificationBitfield.shln(1).modn(4) === 0b11 && state.previousJustifiedEpoch === previousEpoch.subn(1)) {
      state.finalizedEpoch = state.previousJustifiedEpoch;
    }
    if (state.justificationBitfield.shln(0).modn(8) === 0b111 && state.justifiedEpoch === previousEpoch.subn(1)) {
      state.finalizedEpoch = state.justifiedEpoch;
    }
    if (state.justificationBitfield.ishln(0).modn(4) === 0b11 && state.justifiedEpoch === previousEpoch) {
      state.finalizedEpoch = state.justifiedEpoch;
    }
    state.previousJustifiedEpoch = state.justifiedEpoch;
    state.justifiedEpoch = newJustifiedEpoch;

    ///
    // Crosslinks
    ///
    // For every slot in range(get_epoch_start_slot(previous_epoch), get_epoch_start_slot(next_epoch)), let crosslink_committees_at_slot = get_crosslink_committees_at_slot(state, slot). For every (crosslink_committee, shard) in crosslink_committees_at_slot, compute:
    //
    // Set state.latest_crosslinks[shard] = Crosslink(epoch=slot_to_epoch(slot), shard_block_root=winning_root(crosslink_committee)) if 3 * total_attesting_balance(crosslink_committee) >= 2 * get_total_balance(crosslink_committee).

    ///
    // Rewards and penalties
    ///

    // TODO make sure not to underflow
    const baseRewardQuotient = previousTotalBalance.sqr().divn(BASE_REWARD_QUOTIENT);
    const baseReward = (state: BeaconState, index: ValidatorIndex) => getEffectiveBalance(state, index).div(baseRewardQuotient).divn(5);
    const inactivityPenalty = (state: BeaconState, index: ValidatorIndex, epochsSinceFinality: Epoch): BN => {
      return baseReward(state, index)
        .add(getEffectiveBalance(state, index))
        .mul(epochsSinceFinality)
        .divn(INACTIVITY_PENALTY_QUOTIENT)
        .divn(2);
    };

    // Justification and finalization
    const validators = getActiveValidatorIndices(state.validatorRegistry, previousEpoch);
    const epochsSinceFinality = nextEpoch.sub(state.finalizedEpoch);

    // CASE 1
    if (epochsSinceFinality.ltn(4)) {
      // Expected FFG source
      for (let index of previousEpochAttesterIndices) {
        // IFF validator is active and they were not in previousEpochAttesterIndices slash
        if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochAttesterIndices.includes(index)) {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
        } else {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state, index).mul(previousEpochAttestingBalance).div(previousTotalBalance));
        }
      }

      // Expected FFG target
      for (let index of previousEpochBoundaryAttesterIndices) {
        // IFF validator is active and they were not in previousEpochAttesterIndices slash
        if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochBoundaryAttesterIndices.includes(index)) {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
        } else {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state, index).mul(previousEpochBoundaryAttestingBalance).div(previousTotalBalance));
        }
      }

      // Expected beacon chain head
      for (let index of previousEpochHeadAttesterIndices) {
        // IFF validator is active and they were not in previousEpochAttesterIndices slash
        if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochHeadAttesterIndices.includes(index)) {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
        } else {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state, index).mul(previousEpochHeadAttestingBalance).div(previousTotalBalance));
        }
      }

      // Inclusion distance
      for (let index of previousEpochAttesterIndices) {
        // IFF validator is active and they were not in previousEpochAttesterIndices slash
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].add(baseReward(state,index).muln(MIN_ATTESTATION_INCLUSION_DELAY).div(inclusionDistance(state, index)));
      }
    // CASE 2
    } else if (epochsSinceFinality.gtn(4)) {
      for (let index of previousEpochAttesterIndices) {
        if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochAttesterIndices.includes(index)) {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(inactivityPenalty(state, index, epochsSinceFinality));
        }
      }

      for (let index of previousEpochBoundaryAttesterIndices) {
        if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochBoundaryAttesterIndices.includes(index)) {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(inactivityPenalty(state, index, epochsSinceFinality));
        }
      }

      for (let index of previousEpochHeadAttesterIndices) {
        if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && !previousEpochHeadAttesterIndices.includes(index)) {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index));
        }
      }

      for (let index of previousEpochAttesterIndices) {
        if (isActiveValidator(state.validatorRegistry[index.toNumber()], previousEpoch) && state.validatorRegistry[index.toNumber()].slashedEpoch <= currentEpoch) {
          state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(inactivityPenalty(state, index, epochsSinceFinality).muln(2).add(baseReward(state, index)));
        }
      }

      for (let index of previousEpochAttesterIndices) {
        state.validatorBalances[index.toNumber()] = state.validatorBalances[index.toNumber()].sub(baseReward(state, index).sub(baseReward(state,index)).muln(MIN_ATTESTATION_INCLUSION_DELAY).div(inclusionDistance(state, index)));
      }
    }

    ///
    // Attestation Inclusion
    ///
    for (let index of previousEpochAttesterIndices) {
      const proposerIndex = getBeaconProposerIndex(state, inclusionSlot(state, index));
      state.validatorBalances[proposerIndex] = state.validatorBalances[proposerIndex].add(baseReward(state, index)).divn(ATTESTATION_INCLUSION_REWARD_QUOTIENT);
    }

    ///
    // Ejections
    ///
    processEjections(state);

    ///
    // Validator Registry and shuffling seed data
    ///
    state.previousShufflingEpoch = state.currentShufflingEpoch;
    state.previousShufflingStartShard = state.currentShufflingStartShard;
    state.previousShufflingSeed = state.currentShufflingSeed;

    // TODO :: ensure conditions below are met
    if (true) {
      // state.finalized_epoch > state.validator_registry_update_epoch
      // state.latest_crosslinks[shard].epoch > state.validator_registry_update_epoch for every shard number shard in
      // [(state.current_shuffling_start_shard + i) % SHARD_COUNT for i in range(get_current_epoch_committee_count(state))]
      // (that is, for every shard in the current committees)
      // updateValidatorRegistry(state)

      state.currentShufflingEpoch = nextEpoch;
      state.currentShufflingStartShard = (state.currentShufflingStartShard.addn(getCurrentEpochCommitteeCount(state))).mod(new BN(SHARD_COUNT));
      state.currentShufflingSeed = generateSeed(state, state.currentShufflingEpoch);
    } else {
      const epochsSinceLastRegistryUpdate = currentEpoch.sub(state.validatorRegistryUpdateEpoch);
      if (epochsSinceLastRegistryUpdate.gtn(1) && isPowerOfTwo(epochsSinceLastRegistryUpdate)) {
        state.currentShufflingEpoch = nextEpoch;
        state.currentShufflingSeed = generateSeed(state, state.currentShufflingEpoch);
      }
    }
  }

  processSlashing(state);
  processExitQueue(state);

  state.latestActiveIndexRoots[(nextEpoch + ACTIVATION_EXIT_DELAY) % LATEST_ACTIVE_INDEX_ROOTS_LENGTH] = hashTreeRoot(getActiveValidatorIndices(state.validatorRegistry, nextEpoch + ACTIVATION_EXIT_DELAY));
  state.latestSlashedBalances[(nextEpoch) % LATEST_SLASHED_EXIT_LENGTH] = state.latestSlashedBalances[currentEpoch.modn(LATEST_SLASHED_EXIT_LENGTH)];
  state.latestRandaoMixes[nextEpoch % LATEST_RANDAO_MIXES_LENGTH] = getRandaoMix(state, currentEpoch);

  for (let attestation of state.latestAttestations) {
    if (slotToEpoch(attestation.data.slot).lt(currentEpoch)) {
      const i = state.latestAttestations.indexOf(attestation);
      state.latestAttestations.splice(i, 1);
    }
  }

  // assert(block.stateRoot ==== hashTreeRoot(state))
  return state;
}

/**
 * Iterate through the validator registry and eject active validators with balance below EJECTION_BALANCE.
 * @param {BeaconState} state
 */
function processEjections(state: BeaconState): void {
  for (let index of getActiveValidatorIndices(state.validatorRegistry, getCurrentEpoch(state))) {
    if (state.validatorBalances[index.toNumber()].ltn(EJECTION_BALANCE)) {
      exitValidator(state, index);
    }
  }
}

/**
 * Updates the validator registry
 * @param {BeaconState} state
 */
function updateValidatorRegistry(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  // The active validators
  const activeValidatorIndices = getActiveValidatorIndices(state.validatorRegistry, currentEpoch);
  // The total effective balance of active validators
  const totalBalance = getTotalBalance(state, activeValidatorIndices);

  // The maximum balance chrun in Gwei (for deposits and exists separately)
  const a = new BN(MAX_DEPOSIT_AMOUNT);
  const b = totalBalance.divn(2 * MAX_BALANCE_CHURN_QUOTIENT);
  const maxBalanceChrun = a.gt(b) ? a : b;

  // Activate validators within the allowable balance churn
  let balanceChurn = new BN(0);
  state.validatorRegistry.forEach((validator, index) => {
    if (validator.activationEpoch > getEntryExitEffectEpoch(currentEpoch) && state.validatorBalances[index].lten(MAX_DEPOSIT_AMOUNT)) {
      // Check the balance churn would be within the allowance
      balanceChurn = balanceChurn.add(getEffectiveBalance(state, new BN(index)));
      if (balanceChurn.gt(maxBalanceChrun)) {
        return;
      }
      // Activate Validator
      activateValidator(state, new BN(index), false);
    }
  });

  // Exit validators within the allowable balance churn
  balanceChurn = new BN(0);
  state.validatorRegistry.forEach((validator, index) => {
    if (validator.exitEpoch > getEntryExitEffectEpoch(currentEpoch) && validator.statusFlags.and(INITIATED_EXIT)) {
      // Check the balance churn would be within the allowance
      balanceChurn = balanceChurn.add(getEffectiveBalance(state, new BN(index)));
      if (balanceChurn.gt(maxBalanceChrun)) {
        return;
      }
      // Exit Validator
      exitValidator(state, index);
    }
  });

  state.validatorRegistryUpdateEpoch = currentEpoch;
}

/**
 * Process the slashings.
 * @param {BeaconState} state
 */
function processSlashing(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const activeValidatorIndices = getActiveValidatorIndices(state.validatorRegistry, currentEpoch);
  const totalBalance = activeValidatorIndices.reduce((acc, cur) => acc.add(getEffectiveBalance(state, cur)), new BN(0));

}
