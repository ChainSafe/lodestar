import {gloas} from "@lodestar/types";
import {getIndexedPayloadAttestationSignatureSet} from "../signatureSets/index.ts";
import {CachedBeaconStateGloas} from "../types.js";
import {verifySignatureSet} from "../util/index.ts";

export function isValidIndexedPayloadAttestation(
  state: CachedBeaconStateGloas,
  indexedPayloadAttestation: gloas.IndexedPayloadAttestation,
  verifySignature: boolean
): boolean {
  const indices = indexedPayloadAttestation.attestingIndices;
  const isSorted = indices.every((val, i, arr) => i === 0 || arr[i - 1] <= val);

  if (indices.length === 0 || !isSorted) {
    return false;
  }

  if (verifySignature) {
    return verifySignatureSet(getIndexedPayloadAttestationSignatureSet(state, indexedPayloadAttestation));
  }

  return true;
}
