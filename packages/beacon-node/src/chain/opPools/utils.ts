import bls from "@chainsafe/bls";
import {CoordType, Signature} from "@chainsafe/bls/types";
import {BLS_WITHDRAWAL_PREFIX} from "@lodestar/params";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Slot, capella} from "@lodestar/types";

/**
 * Prune a Map indexed by slot to keep the most recent slots, up to `slotsRetained`
 */
export function pruneBySlot(map: Map<Slot, unknown>, slot: Slot, slotsRetained: Slot): Slot {
  const lowestPermissibleSlot = Math.max(slot - slotsRetained, 0);

  // No need to prune if the lowest permissible slot has not changed and the queue length is less than the maximum
  if (map.size <= slotsRetained) {
    return lowestPermissibleSlot;
  }

  // Remove the oldest slots to keep a max of `slotsRetained` slots
  const slots = Array.from(map.keys());
  const slotsToDelete = slots.sort((a, b) => b - a).slice(slotsRetained);
  for (const slot of slotsToDelete) {
    map.delete(slot);
  }

  return lowestPermissibleSlot;
}

/**
 * De-serialize bytes into Signature.
 * No need to verify Signature is valid, already run sig-verify = false
 */
export function signatureFromBytesNoCheck(signature: Uint8Array): Signature {
  return bls.Signature.fromBytes(signature, CoordType.affine, false);
}

/**
 * Ensures that a SignedBLSToExecutionChange object is _still_ valid for block inclusion. An object valid for the pool,
 * can become invalid for certain forks.
 */
export function isValidBlsToExecutionChangeForBlockInclusion(
  state: CachedBeaconStateAllForks,
  signedBLSToExecutionChange: capella.SignedBLSToExecutionChange
): boolean {
  // For each condition from https://github.com/ethereum/consensus-specs/blob/dev/specs/capella/beacon-chain.md#new-process_bls_to_execution_change
  //
  // 1. assert address_change.validator_index < len(state.validators):
  //    If valid before will always be valid in the future, no need to check
  //
  // 2. assert validator.withdrawal_credentials[:1] == BLS_WITHDRAWAL_PREFIX:
  //    Must be checked again, since it can already be changed by now.
  const validator = state.validators.getReadonly(signedBLSToExecutionChange.message.validatorIndex);
  const {withdrawalCredentials} = validator;
  if (withdrawalCredentials[0] !== BLS_WITHDRAWAL_PREFIX) {
    return false;
  }

  // 3. assert validator.withdrawal_credentials[1:] == hash(address_change.from_bls_pubkey)[1:]:
  //    If valid before will always be valid in the future, no need to check

  return true;
}
