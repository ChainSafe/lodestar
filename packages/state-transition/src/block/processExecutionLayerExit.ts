import {CompositeViewDU} from "@chainsafe/ssz";
import {electra, ssz} from "@lodestar/types";
import {ETH1_ADDRESS_WITHDRAWAL_PREFIX, FAR_FUTURE_EPOCH} from "@lodestar/params";

import {isActiveValidator} from "../util/index.js";
import {CachedBeaconStateElectra} from "../types.js";
import {initiateValidatorExit} from "./index.js";

/**
 * Process execution layer exit messages and initiate exit incase they belong to a valid active validator
 * otherwise silent ignore.
 */
export function processExecutionLayerExit(
  state: CachedBeaconStateElectra,
  exit: electra.ExecutionLayerWithdrawalRequest
): void {
  const validator = isValidExecutionLayerExit(state, exit);
  if (validator === null) {
    return;
  }

  initiateValidatorExit(state, validator);
}

export function isValidExecutionLayerExit(
  state: CachedBeaconStateElectra,
  exit: electra.ExecutionLayerWithdrawalRequest
): CompositeViewDU<typeof ssz.phase0.Validator> | null {
  const {config, epochCtx} = state;
  const validatorIndex = epochCtx.getValidatorIndex(exit.validatorPubkey);
  const validator = validatorIndex !== undefined ? state.validators.getReadonly(validatorIndex) : undefined;
  if (validator === undefined) {
    return null;
  }

  const {withdrawalCredentials} = validator;
  if (withdrawalCredentials[0] !== ETH1_ADDRESS_WITHDRAWAL_PREFIX) {
    return null;
  }

  const executionAddress = withdrawalCredentials.subarray(12, 32);
  if (Buffer.compare(executionAddress, exit.sourceAddress) !== 0) {
    return null;
  }

  const currentEpoch = epochCtx.epoch;
  if (
    // verify the validator is active
    isActiveValidator(validator, currentEpoch) &&
    // verify exit has not been initiated
    validator.exitEpoch === FAR_FUTURE_EPOCH &&
    // verify the validator had been active long enough
    currentEpoch >= validator.activationEpoch + config.SHARD_COMMITTEE_PERIOD
  ) {
    return validator;
  } else {
    return null;
  }
}
