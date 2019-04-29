import {
  BeaconState,
  Epoch,
  Validator,
  ValidatorIndex,
} from "../../../types";


/**
 * Check if validator is active
 * @param {Validator} validator
 * @param {Epoch} epoch
 * @returns {boolean}
 */
export function isActiveValidator(validator: Validator, epoch: Epoch): boolean {
  return validator.activationEpoch <= epoch && epoch < validator.exitEpoch;
}

/**
 * Check if validator is slashable
 * @param {Validator} validator
 * @param {Epoch} epoch
 * @returns {boolean}
 */
export function isSlashableValidator(validator: Validator, epoch: Epoch): boolean {
  return (
    !validator.slashed &&
    validator.activationEpoch <= epoch &&
    epoch < validator.withdrawableEpoch
  );
}

/**
 * Get indices of active validators from validators.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {ValidatorIndex[]}
 */
export function getActiveValidatorIndices(state: BeaconState, epoch: Epoch): ValidatorIndex[] {
  return state.validatorRegistry.reduce((indices, validator, index) => {
    if (isActiveValidator(validator, epoch)) {
      indices.push(index);
    }
    return indices;
  }, []);
}
