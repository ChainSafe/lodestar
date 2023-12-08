import {capella} from "@lodestar/types";
import {
  isValidBLSToExecutionChange,
  getBLSToExecutionChangeSignatureSet,
  CachedBeaconStateCapella,
} from "@lodestar/state-transition";
import {IBeaconChain} from "..";
import {BLSToExecutionChangeError, BLSToExecutionChangeErrorCode, GossipAction} from "../errors/index.js";

export async function validateApiBLSToExecutionChange(
  chain: IBeaconChain,
  blsToExecutionChange: capella.SignedBLSToExecutionChange
): Promise<void> {
  const ignoreExists = true;
  const prioritizeBls = true;
  return validateBLSToExecutionChange(chain, blsToExecutionChange, {ignoreExists, prioritizeBls});
}

export async function validateGossipBLSToExecutionChange(
  chain: IBeaconChain,
  blsToExecutionChange: capella.SignedBLSToExecutionChange
): Promise<void> {
  return validateBLSToExecutionChange(chain, blsToExecutionChange);
}

async function validateBLSToExecutionChange(
  chain: IBeaconChain,
  blsToExecutionChange: capella.SignedBLSToExecutionChange,
  opts: {ignoreExists?: boolean; prioritizeBls?: boolean} = {ignoreExists: false, prioritizeBls: false}
): Promise<void> {
  const {ignoreExists, prioritizeBls} = opts;
  // [IGNORE] The blsToExecutionChange is the first valid blsToExecutionChange received for the validator with index
  // signedBLSToExecutionChange.message.validatorIndex.
  if (!ignoreExists && chain.opPool.hasSeenBLSToExecutionChange(blsToExecutionChange.message.validatorIndex)) {
    throw new BLSToExecutionChangeError(GossipAction.IGNORE, {
      code: BLSToExecutionChangeErrorCode.ALREADY_EXISTS,
    });
  }

  // validate bls to executionChange
  // NOTE: No need to advance head state since the signature's fork is handled with `broadcastedOnFork`,
  // and chanes relevant to `isValidBlsToExecutionChange()` happen only on processBlock(), not processEpoch()
  const state = chain.getHeadState();
  const {config} = state;

  // [REJECT] All of the conditions within process_bls_to_execution_change pass validation.
  // verifySignature = false, verified in batch below
  const {valid} = isValidBLSToExecutionChange(state as CachedBeaconStateCapella, blsToExecutionChange, false);
  if (!valid) {
    throw new BLSToExecutionChangeError(GossipAction.REJECT, {
      code: BLSToExecutionChangeErrorCode.INVALID,
    });
  }

  const signatureSet = getBLSToExecutionChangeSignatureSet(config, blsToExecutionChange);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new BLSToExecutionChangeError(GossipAction.REJECT, {
      code: BLSToExecutionChangeErrorCode.INVALID_SIGNATURE,
    });
  }
}
