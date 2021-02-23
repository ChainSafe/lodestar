import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient, ValidatorFlag, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {getCurrentEpoch, getPreviousEpoch} from "../..";
import {assert} from "@chainsafe/lodestar-utils";
import {getActiveValidatorIndices} from "../../util/validator";
import {hasValidatorFlags} from "../misc";

export function getUnslashedParticipatingIndices(
  config: IBeaconConfig,
  state: lightclient.BeaconState,
  flags: ValidatorFlag,
  epoch: Epoch
): ValidatorIndex[] {
  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  assert.gte(epoch, previousEpoch);
  assert.lte(epoch, currentEpoch);
  const epochParticipation =
    epoch === currentEpoch ? state.currentEpochParticipation : state.previousEpochParticipation;

  return getActiveValidatorIndices(state, epoch).filter(
    (validatorIndex) =>
      hasValidatorFlags(epochParticipation[validatorIndex], flags) && !state.validators[validatorIndex].slashed
  );
}
