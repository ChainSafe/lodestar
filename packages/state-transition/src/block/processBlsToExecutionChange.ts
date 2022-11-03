import {capella, ssz} from "@lodestar/types";
import {BLS_WITHDRAWAL_PREFIX, ETH1_ADDRESS_WITHDRAWAL_PREFIX, WITHDRAWAL_PREFIX_BYTES} from "@lodestar/params";
import {toHexString, byteArrayEquals} from "@chainsafe/ssz";
import {digest} from "@chainsafe/as-sha256";

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
  // We need to work on the slice otherwise ssz view seems to be getting messed up
  // once we modify this using set for putting new credentials
  const withdrawalCredentials = validator.withdrawalCredentials.slice();
  const credentialPrefix = withdrawalCredentials.slice(0, WITHDRAWAL_PREFIX_BYTES);
  if (!byteArrayEquals(credentialPrefix, BLS_WITHDRAWAL_PREFIX)) {
    throw Error(`Invalid withdrawalCredentials prefix expected=${BLS_WITHDRAWAL_PREFIX} actual=${credentialPrefix}`);
  }
  if (
    !byteArrayEquals(
      withdrawalCredentials.slice(WITHDRAWAL_PREFIX_BYTES, 32),
      digest(addressChange.fromBlsPubkey).slice(WITHDRAWAL_PREFIX_BYTES, 32)
    )
  ) {
    throw Error(
      `Invalid withdrawalCredentials expected=${toHexString(
        withdrawalCredentials.slice(WITHDRAWAL_PREFIX_BYTES, 32)
      )} actual=${toHexString(
        ssz.BLSPubkey.hashTreeRoot(addressChange.fromBlsPubkey).slice(WITHDRAWAL_PREFIX_BYTES, 32)
      )}`
    );
  }
  withdrawalCredentials.set(ETH1_ADDRESS_WITHDRAWAL_PREFIX);
  withdrawalCredentials.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], WITHDRAWAL_PREFIX_BYTES);
  withdrawalCredentials.set(addressChange.toExecutionAddress, 12);
  // Set the new credentials back
  validator.withdrawalCredentials = withdrawalCredentials;
}
