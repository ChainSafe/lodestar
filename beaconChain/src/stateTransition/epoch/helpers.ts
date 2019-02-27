import {
  getActiveValidatorIndices, getAttestationParticipants, getCurrentEpoch, getCurrentEpochCommitteeCount,
  getEffectiveBalance, getEntryExitEffectEpoch, getTotalBalance
} from "../../../helpers/stateTransitionHelpers";
import {Attestation, BeaconState, PendingAttestation, Shard, uint64, Validator, ValidatorIndex} from "../../../types";
import {
  EJECTION_BALANCE, FAR_FUTURE_EPOCH, INITIATED_EXIT, LATEST_SLASHED_EXIT_LENGTH, MAX_BALANCE_CHURN_QUOTIENT,
  MAX_DEPOSIT_AMOUNT, MAX_EXIT_DEQUEUES_PER_EPOCH, MIN_PENALTY_QUOTIENT,
  MIN_VALIDATOR_WITHDRAWAL_DELAY,
  SHARD_COUNT
} from "../../../constants";
import BN from "bn.js";
import {activateValidator, exitValidator, prepareValidatorForWithdrawal} from "../../../helpers/validatorStatus";
import {bnMax, bnMin} from "../../../helpers/math";

/**
 * Check if the latest crosslink epochs are valid for all shards.
 * @param {BeaconState} state
 * @returns {boolean}
 */
export function isValidCrosslink(state: BeaconState): boolean {
  return Array.from({ length: getCurrentEpochCommitteeCount(state) },
    (_, i) => state.currentShufflingStartShard.addn(i).modn(SHARD_COUNT))
    .every((shard) => state.latestCrosslinks[shard].epoch.lte(state.validatorRegistryUpdateEpoch));
}

/**
 * Process the slashings.
 * @param {BeaconState} state
 */
export function processSlashings(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const activeValidatorIndices = getActiveValidatorIndices(state.validatorRegistry, currentEpoch);
  const totalBalance = activeValidatorIndices.reduce((acc, cur) => acc.add(getEffectiveBalance(state, cur)), new BN(0));

  state.validatorRegistry.map((validator: Validator, index: number) => {
    if (currentEpoch.eq(validator.slashedEpoch.addn(LATEST_SLASHED_EXIT_LENGTH).divn(2))) {
      const epochIndex = currentEpoch.modn(LATEST_SLASHED_EXIT_LENGTH);
      const totalAtStart = state.latestSlashedBalances[(epochIndex + 1) % LATEST_SLASHED_EXIT_LENGTH];
      const totalAtEnd = state.latestSlashedBalances[epochIndex];
      const totalPenalties = totalAtEnd.sub(totalAtStart);
      // const penalty1 = getEffectiveBalance(state, new BN(index)).mul()
      // const penalty = getEffectiveBalance(state, new BN(index))
      const penalty = bnMax(
        getEffectiveBalance(state, new BN(index)).mul(bnMin(totalPenalties.muln(3), totalBalance)).div(totalBalance),
        getEffectiveBalance(state, new BN(index)).divn(MIN_PENALTY_QUOTIENT)
      );
      state.validatorBalances[index] = state.validatorBalances[index].sub(penalty);
    }
  })
}

/**
 * Updates the validator registry
 * @param {BeaconState} state
 */
export function updateValidatorRegistry(state: BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  // The active validators
  const activeValidatorIndices = getActiveValidatorIndices(state.validatorRegistry, currentEpoch);
  // The total effective balance of active validators
  const totalBalance = getTotalBalance(state, activeValidatorIndices);

  // The maximum balance chrun in Gwei (for deposits and exists separately)
  const a = new BN(MAX_DEPOSIT_AMOUNT);
  const b = totalBalance.divn(2 * MAX_BALANCE_CHURN_QUOTIENT);
  const maxBalanceChurn = a.gt(b) ? a : b;

  // Activate validators within the allowable balance churn
  let balanceChurn = new BN(0);
  state.validatorRegistry.forEach((validator, index) => {
    if (validator.activationEpoch.gt(getEntryExitEffectEpoch(currentEpoch)) && state.validatorBalances[index].lten(MAX_DEPOSIT_AMOUNT)) {
      // Check the balance churn would be within the allowance
      balanceChurn = balanceChurn.add(getEffectiveBalance(state, new BN(index)));
      if (balanceChurn.gt(maxBalanceChurn)) {
        return;
      }
      // Activate Validator
      activateValidator(state, new BN(index), false);
    }
  });

  // Exit validators within the allowable balance churn
  balanceChurn = new BN(0);
  state.validatorRegistry.forEach((validator: Validator, i) => {
    const index: ValidatorIndex = new BN(i);
    if (validator.exitEpoch.gt(getEntryExitEffectEpoch(currentEpoch)) && validator.statusFlags.and(INITIATED_EXIT)) {
      // Check the balance churn would be within the allowance
      balanceChurn = balanceChurn.add(getEffectiveBalance(state, index));
      if (balanceChurn.gt(maxBalanceChurn)) {
        return;
      }
      // Exit Validator
      exitValidator(state, index);
    }
  });

  state.validatorRegistryUpdateEpoch = currentEpoch;
}

/**
 * Iterate through the validator registry and eject active validators with balance below EJECTION_BALANCE.
 * @param {BeaconState} state
 */
export function processEjections(state: BeaconState): void {
  for (let index of getActiveValidatorIndices(state.validatorRegistry, getCurrentEpoch(state))) {
    if (state.validatorBalances[index.toNumber()].ltn(EJECTION_BALANCE)) {
      exitValidator(state, index);
    }
  }
}

/**
 * Returns the attestation with the lowest inclusion slot for a specified validatorIndex.
 * @param {BeaconState} state
 * @param {ValidatorIndex} validatorIndex
 * @returns {uint64}
 */
export function inclusionSlot(state: BeaconState, previousEpochAttestations: PendingAttestation[], validatorIndex: ValidatorIndex): uint64 {
  let lowestInclusionSlot: uint64;
  previousEpochAttestations.forEach((attestation: PendingAttestation) => {
    getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield)
      .forEach((index: ValidatorIndex) => {
        if (index.eq(validatorIndex)) {
          if (!lowestInclusionSlot) {
            lowestInclusionSlot = attestation.inclusionSlot;
          } else if (attestation.inclusionSlot.lt(lowestInclusionSlot)) {
            lowestInclusionSlot = attestation.inclusionSlot;
          }
        }
      })
  });
  return lowestInclusionSlot;
}

export function inclusionDistance(state: BeaconState, validatorIndex: ValidatorIndex): uint64 {
  let lowestAttestation: PendingAttestation;
  state.latestAttestations.forEach((attestation: PendingAttestation) => {
    getAttestationParticipants(state, attestation.data, attestation.aggregationBitfield)
      .forEach((index: ValidatorIndex) => {
        if (index.eq(validatorIndex) && attestation.inclusionSlot.lt(lowestAttestation.inclusionSlot)) {
          lowestAttestation = attestation;
        }
      })
  });
  return lowestAttestation.inclusionSlot.sub(lowestAttestation.data.slot);
}

/**
 * Process the exit queue.
 * @param {BeaconState} state
 */
export function processExitQueue(state: BeaconState): void {
  const eligibleIndices: number[] = Array.from({length: state.validatorRegistry.length})
    .map(Number.call, Number)
    .filter((index: number) => {
      const validator = state.validatorRegistry[index];

      // Dequeue if the minimum amount of time has passed
      if (validator.withdrawalEpoch.lt(FAR_FUTURE_EPOCH)) {
        return false;
      }
      return getCurrentEpoch(state).gte(validator.exitEpoch.addn(MIN_VALIDATOR_WITHDRAWAL_DELAY))
    });

  // Sort in order of exit epoch, and validators that exit within the same epoch exit in order of validator index
  const sortedIndices: number[] = eligibleIndices.sort((a: number, b: number) => {
    return state.validatorRegistry[a].exitEpoch.sub(state.validatorRegistry[b].exitEpoch).toNumber();
  });
  sortedIndices.map((dequeues: number, index: number) => {
    if (dequeues < MAX_EXIT_DEQUEUES_PER_EPOCH) {
      prepareValidatorForWithdrawal(state, new BN(index));
    }
  });
}

export function winningRoot(state: BeaconState) {

}
