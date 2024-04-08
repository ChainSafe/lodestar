import {byteArrayEquals} from "@chainsafe/ssz";
import {electra} from "@lodestar/types";
import {ETH1_ADDRESS_WITHDRAWAL_PREFIX, FAR_FUTURE_EPOCH} from "@lodestar/params";

import {isActiveValidator} from "../util/index.js";
import {CachedBeaconStateElectra} from "../types.js";
import {initiateValidatorExit} from "./index.js";

export function processExecutionLayerExit(state: CachedBeaconStateElectra, exit: electra.ExecutionLayerExit): void {
  if (!isValidExecutionLayerExit(state, exit)) {
    return;
  }

  const {epochCtx} = state;
  const validatorIndex = epochCtx.getValidatorIndex(exit.validatorPubkey);
  const validator = validatorIndex !== undefined ? state.validators.get(validatorIndex) : undefined;
  if (validator === undefined) {
    throw Error("Internal error validator=undefined for a valid execution layer exit");
  }
  initiateValidatorExit(state, validator);
}

export function isValidExecutionLayerExit(state: CachedBeaconStateElectra, exit: electra.ExecutionLayerExit): boolean {
  const {config, epochCtx} = state;
  const validatorIndex = epochCtx.getValidatorIndex(exit.validatorPubkey);
  const validator = validatorIndex !== undefined ? state.validators.getReadonly(validatorIndex) : undefined;
  if (validator === undefined) {
    return false;
  }

  const {withdrawalCredentials} = validator;
  if (withdrawalCredentials[0] !== ETH1_ADDRESS_WITHDRAWAL_PREFIX) {
    return false;
  }

  const executionAddress = withdrawalCredentials.slice(12, 32);
  if (!byteArrayEquals(executionAddress, exit.sourceAddress)) {
    return false;
  }

  const currentEpoch = epochCtx.epoch;
  return (
    // verify the validator is active
    isActiveValidator(validator, currentEpoch) &&
    // verify exit has not been initiated
    validator.exitEpoch === FAR_FUTURE_EPOCH &&
    // verify the validator had been active long enough
    currentEpoch >= validator.activationEpoch + config.SHARD_COMMITTEE_PERIOD
  );
}
