import {capella, ssz} from "@lodestar/types";
import {BLS_WITHDRAWAL_PREFIX, ETH1_ADDRESS_WITHDRAWAL_PREFIX, WITHDRAWAL_PREFIX_BYTES} from "@lodestar/params";
import {byteArrayEquals, toHexString} from "@chainsafe/ssz";

import {CachedBeaconStateCapella} from "../types.js";

export function processBlsToExecutionChange(
  state: CachedBeaconStateCapella,
  signedBlsToExecutionChange: capella.SignedBLSToExecutionChange
): void {
  const addressChange = signedBlsToExecutionChange.message;
  if (addressChange.validatorIndex >= state.validators.length) {
    throw Error(`Invalid validatorIndex expected<${state.validators.length} actual=${addressChange.validatorIndex}`);
  }
  const validator = state.validators.get(addressChange.validatorIndex);
  if (byteArrayEquals(validator.withdrawalCredentials.slice(0, WITHDRAWAL_PREFIX_BYTES), BLS_WITHDRAWAL_PREFIX)) {
    throw Error(
      `Invalid withdrawalCredentials prefix expected=${BLS_WITHDRAWAL_PREFIX} actual=${validator.withdrawalCredentials.slice(
        0,
        WITHDRAWAL_PREFIX_BYTES
      )}`
    );
  }
  if (
    !byteArrayEquals(
      validator.withdrawalCredentials.slice(WITHDRAWAL_PREFIX_BYTES, 32),
      ssz.BLSPubkey.hashTreeRoot(addressChange.fromBlsPubkey).slice(WITHDRAWAL_PREFIX_BYTES, 32)
    )
  ) {
    throw Error(
      `Invalid withdrawalCredentials expected=${toHexString(
        validator.withdrawalCredentials.slice(WITHDRAWAL_PREFIX_BYTES, 32)
      )} actual=${toHexString(
        ssz.BLSPubkey.hashTreeRoot(addressChange.fromBlsPubkey).slice(WITHDRAWAL_PREFIX_BYTES, 32)
      )}`
    );
  }
  // TODO: add verify signature sets
  // TODO clean this up
  validator.withdrawalCredentials.set(ETH1_ADDRESS_WITHDRAWAL_PREFIX);
  validator.withdrawalCredentials.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], WITHDRAWAL_PREFIX_BYTES);
  validator.withdrawalCredentials.set(addressChange.toExecutionAddress, 12);
}
