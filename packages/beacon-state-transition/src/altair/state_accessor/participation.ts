import {altair, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {getCurrentEpoch, getPreviousEpoch} from "../../util";
import {assert} from "@chainsafe/lodestar-utils";
import {getActiveValidatorIndices} from "../../util/validator";
import {hasFlag} from "../misc";

/**
 *     Return the active and unslashed validator indices for the given epoch and flag index.
 */
export function getUnslashedParticipatingIndices(
  state: altair.BeaconState,
  flagIndex: number,
  epoch: Epoch
): ValidatorIndex[] {
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = getPreviousEpoch(state);
  assert.gte(epoch, previousEpoch);
  assert.lte(epoch, currentEpoch);
  const epochParticipation =
    epoch === currentEpoch ? state.currentEpochParticipation : state.previousEpochParticipation;

  return getActiveValidatorIndices(state, epoch).filter(
    (validatorIndex) =>
      hasFlag(epochParticipation[validatorIndex], flagIndex) && !state.validators[validatorIndex].slashed
  );
}
