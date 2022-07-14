import {EFFECTIVE_BALANCE_INCREMENT, TIMELY_TARGET_FLAG_INDEX} from "@lodestar/params";
import {Epoch, phase0} from "@lodestar/types";
import {isActiveValidator} from "./validator.js";

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;

/**
 * TODO: describe issue. Compute progressive target balances
 * Compute balances from zero, note this state could be mid-epoch so target balances != 0
 * @param participation from `state.previousEpochParticipation.getAll()`
 * @param epoch either currentEpoch or previousEpoch
 * @param validators from `state.validators.getAllReadonlyValues()`
 */
export function sumTargetUnslashedBalanceIncrements(
  participation: number[],
  epoch: Epoch,
  validators: phase0.Validator[]
): number {
  let total = 0;
  for (let i = 0; i < participation.length; i++) {
    if ((participation[i] & TIMELY_TARGET) === TIMELY_TARGET) {
      const validator = validators[i];
      if (isActiveValidator(validator, epoch) && !validator.slashed) {
        total += Math.floor(validator.effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
      }
    }
  }
  return total;
}
