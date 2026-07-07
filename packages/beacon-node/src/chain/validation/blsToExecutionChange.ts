import {getBlsToExecutionChangeSignatureSet, isValidBlsToExecutionChange} from "@lodestar/state-transition";
import {capella} from "@lodestar/types";
import type {BeaconEngine} from "../beaconEngine/beaconEngine.js";
import {BlsToExecutionChangeError, BlsToExecutionChangeErrorCode, GossipAction} from "../errors/index.js";

export async function validateApiBlsToExecutionChange(
  engine: BeaconEngine,
  blsToExecutionChange: capella.SignedBLSToExecutionChange
): Promise<void> {
  const ignoreExists = true;
  const prioritizeBls = true;
  return validateBlsToExecutionChange(engine, blsToExecutionChange, {ignoreExists, prioritizeBls});
}

export async function validateGossipBlsToExecutionChange(
  engine: BeaconEngine,
  blsToExecutionChange: capella.SignedBLSToExecutionChange
): Promise<void> {
  return validateBlsToExecutionChange(engine, blsToExecutionChange);
}

async function validateBlsToExecutionChange(
  engine: BeaconEngine,
  blsToExecutionChange: capella.SignedBLSToExecutionChange,
  opts: {ignoreExists?: boolean; prioritizeBls?: boolean} = {ignoreExists: false, prioritizeBls: false}
): Promise<void> {
  const {ignoreExists, prioritizeBls} = opts;
  // [IGNORE] The blsToExecutionChange is the first valid blsToExecutionChange received for the validator with index
  // signedBLSToExecutionChange.message.validatorIndex.
  if (!ignoreExists && engine.opPool.hasSeenBlsToExecutionChange(blsToExecutionChange.message.validatorIndex)) {
    throw new BlsToExecutionChangeError(GossipAction.IGNORE, {
      code: BlsToExecutionChangeErrorCode.ALREADY_EXISTS,
    });
  }

  // validate bls to executionChange
  // NOTE: No need to advance head state since the signature's fork is handled with `broadcastedOnFork`,
  // and chanes relevant to `isValidBlsToExecutionChange()` happen only on processBlock(), not processEpoch()
  const state = engine.getHeadState();
  const {config} = engine;
  const addressChange = blsToExecutionChange.message;
  if (addressChange.validatorIndex >= state.validatorCount) {
    throw new BlsToExecutionChangeError(GossipAction.REJECT, {
      code: BlsToExecutionChangeErrorCode.INVALID,
    });
  }
  const validator = state.getValidator(addressChange.validatorIndex);
  // [REJECT] All of the conditions within process_bls_to_execution_change pass validation.
  // verifySignature = false, verified in batch below
  const {valid} = isValidBlsToExecutionChange(config, validator, blsToExecutionChange, false);
  if (!valid) {
    throw new BlsToExecutionChangeError(GossipAction.REJECT, {
      code: BlsToExecutionChangeErrorCode.INVALID,
    });
  }

  const signatureSet = getBlsToExecutionChangeSignatureSet(config, blsToExecutionChange);
  if (!(await engine.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new BlsToExecutionChangeError(GossipAction.REJECT, {
      code: BlsToExecutionChangeErrorCode.INVALID_SIGNATURE,
    });
  }
}
