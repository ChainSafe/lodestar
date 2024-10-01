import {capella} from "@lodestar/types";
import {
  isValidBlsToExecutionChange,
  getBlsToExecutionChangeSignatureSet,
  CachedBeaconStateCapella,
} from "@lodestar/state-transition";
import {IBeaconChain} from "../index.js";
import {BlsToExecutionChangeError, BlsToExecutionChangeErrorCode, GossipAction} from "../errors/index.js";

export async function validateApiBlsToExecutionChange(
  chain: IBeaconChain,
  blsToExecutionChange: capella.SignedBLSToExecutionChange
): Promise<void> {
  const ignoreExists = true;
  const prioritizeBls = true;
  return validateBlsToExecutionChange(chain, blsToExecutionChange, {ignoreExists, prioritizeBls});
}

export async function validateGossipBlsToExecutionChange(
  chain: IBeaconChain,
  blsToExecutionChange: capella.SignedBLSToExecutionChange
): Promise<void> {
  return validateBlsToExecutionChange(chain, blsToExecutionChange);
}

async function validateBlsToExecutionChange(
  chain: IBeaconChain,
  blsToExecutionChange: capella.SignedBLSToExecutionChange,
  opts: {ignoreExists?: boolean; prioritizeBls?: boolean} = {ignoreExists: false, prioritizeBls: false}
): Promise<void> {
  const {ignoreExists, prioritizeBls} = opts;
  // [IGNORE] The blsToExecutionChange is the first valid blsToExecutionChange received for the validator with index
  // signedBLSToExecutionChange.message.validatorIndex.
  if (!ignoreExists && chain.opPool.hasSeenBlsToExecutionChange(blsToExecutionChange.message.validatorIndex)) {
    throw new BlsToExecutionChangeError(GossipAction.IGNORE, {
      code: BlsToExecutionChangeErrorCode.ALREADY_EXISTS,
    });
  }

  // validate bls to executionChange
  // NOTE: No need to advance head state since the signature's fork is handled with `broadcastedOnFork`,
  // and chanes relevant to `isValidBlsToExecutionChange()` happen only on processBlock(), not processEpoch()
  const state = chain.getHeadState();
  const {config} = state;

  // [REJECT] All of the conditions within process_bls_to_execution_change pass validation.
  // verifySignature = false, verified in batch below
  const {valid} = isValidBlsToExecutionChange(state as CachedBeaconStateCapella, blsToExecutionChange, false);
  if (!valid) {
    throw new BlsToExecutionChangeError(GossipAction.REJECT, {
      code: BlsToExecutionChangeErrorCode.INVALID,
    });
  }

  const signatureSet = getBlsToExecutionChangeSignatureSet(config, blsToExecutionChange);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new BlsToExecutionChangeError(GossipAction.REJECT, {
      code: BlsToExecutionChangeErrorCode.INVALID_SIGNATURE,
    });
  }
}
