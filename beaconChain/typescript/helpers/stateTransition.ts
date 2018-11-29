// Helper functions related to state transition functions
// TODO convert Number (in return value for getActiveValidatorIndeces) to and Int

import { ValidatorRecord } from "../interfaces/state";
import { ValidatorStatusCodes } from "../constants/enums";


/**
 * The following is a function that gets active validator indices from the validator list.
 * @param {ValidatorRecord[]} validators
 * @returns {Number[]}
 */
// TODO Need to setup the enums to perform a proper comparison
function getActiveValidatorIndices(validators: ValidatorRecord[]): Number[] {
  return validators.forEach((validator: ValidatorRecord, index: number) => {
    if (validator.status === ValidatorStatusCodes.ACTIVE) return index;
  })
}
