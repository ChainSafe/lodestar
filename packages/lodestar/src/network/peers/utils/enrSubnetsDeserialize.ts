import {getUint8ByteToBitBooleanArray, newFilledArray} from "@chainsafe/lodestar-beacon-state-transition";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";

export const zeroAttnets = newFilledArray(ATTESTATION_SUBNET_COUNT, false);
export const zeroSyncnets = newFilledArray(SYNC_COMMITTEE_SUBNET_COUNT, false);

/**
 * Fast deserialize a BitVector, with pre-cached bool array in `getUint8ByteToBitBooleanArray()`
 *
 * Never throw a deserialization error:
 * - if bytes is too short, it will pad with zeroes
 * - if bytes is too long, it will ignore the extra values
 */
export function deserializeEnrSubnets(bytes: Uint8Array, subnetCount: number): boolean[] {
  if (subnetCount <= 8) {
    return getUint8ByteToBitBooleanArray(bytes[0] ?? 0);
  }

  const boolsArr: boolean[] = [];
  const byteCount = Math.ceil(subnetCount / 8);
  for (let i = 0; i < byteCount; i++) {
    boolsArr.concat(getUint8ByteToBitBooleanArray(bytes[i] ?? 0));
  }

  return boolsArr;
}
