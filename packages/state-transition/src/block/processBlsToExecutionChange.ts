import {capella} from "@lodestar/types";
import {BLS_WITHDRAWAL_PREFIX, ETH1_ADDRESS_WITHDRAWAL_PREFIX} from "@lodestar/params";
import {toHexString, byteArrayEquals} from "@chainsafe/ssz";
import {digest} from "@chainsafe/as-sha256";
import {verifyBlsToExecutionChangeSignature} from "../signatureSets/index.js";

import {CachedBeaconStateCapella} from "../types.js";

export function processBlsToExecutionChange(
  state: CachedBeaconStateCapella,
  signedBlsToExecutionChange: capella.SignedBLSToExecutionChange
): void {
  const addressChange = signedBlsToExecutionChange.message;

  const validation = isValidBlsToExecutionChange(state, signedBlsToExecutionChange, true);
  if (!validation.valid) {
    throw validation.error;
  }

  const validator = state.validators.get(addressChange.validatorIndex);
  const newWithdrawalCredentials = new Uint8Array(32);
  newWithdrawalCredentials[0] = ETH1_ADDRESS_WITHDRAWAL_PREFIX;
  newWithdrawalCredentials.set(addressChange.toExecutionAddress, 12);

  // Set the new credentials back
  validator.withdrawalCredentials = newWithdrawalCredentials;
}

export function isValidBlsToExecutionChange(
  state: CachedBeaconStateCapella,
  signedBLSToExecutionChange: capella.SignedBLSToExecutionChange,
  verifySignature = true
): {valid: true} | {valid: false; error: Error} {
  const addressChange = signedBLSToExecutionChange.message;

  if (addressChange.validatorIndex >= state.validators.length) {
    return {
      valid: false,
      error: Error(
        `withdrawalValidatorIndex ${addressChange.validatorIndex} > state.validators len ${state.validators.length}`
      ),
    };
  }

  const validator = state.validators.getReadonly(addressChange.validatorIndex);
  const {withdrawalCredentials} = validator;
  if (withdrawalCredentials[0] !== BLS_WITHDRAWAL_PREFIX) {
    return {
      valid: false,
      error: Error(
        `Invalid withdrawalCredentials prefix expected=${BLS_WITHDRAWAL_PREFIX} actual=${withdrawalCredentials[0]}`
      ),
    };
  }

  const digestCredentials = digest(addressChange.fromBlsPubkey);
  // Set the BLS_WITHDRAWAL_PREFIX on the digestCredentials for direct match
  digestCredentials[0] = BLS_WITHDRAWAL_PREFIX;
  if (!byteArrayEquals(withdrawalCredentials, digestCredentials)) {
    return {
      valid: false,
      error: Error(
        `Invalid withdrawalCredentials expected=${toHexString(withdrawalCredentials)} actual=${toHexString(
          digestCredentials
        )}`
      ),
    };
  }

  if (verifySignature && !verifyBlsToExecutionChangeSignature(state, signedBLSToExecutionChange)) {
    return {
      valid: false,
      error: Error(
        `Signature could not be verified for BLS to Execution Change for validatorIndex${addressChange.validatorIndex}`
      ),
    };
  }

  return {valid: true};
}
