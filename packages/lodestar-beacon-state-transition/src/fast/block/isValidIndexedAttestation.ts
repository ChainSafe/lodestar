import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {DomainType} from "../../constants";
import {computeSigningRoot, getDomain} from "../../util";
import {ISignatureSet, SignatureSetType, verifySignatureSet} from "../signatureSets";
import {CachedBeaconState} from "../util/cachedBeaconState";

/**
 * Check if `indexedAttestation` has sorted and unique indices and a valid aggregate signature.
 */
export function isValidIndexedAttestation(
  cachedState: CachedBeaconState,
  indexedAttestation: IndexedAttestation,
  verifySignature = true
): boolean {
  const config = cachedState.config;
  const {MAX_VALIDATORS_PER_COMMITTEE} = config.params;
  const indices = getIndices(indexedAttestation);

  // verify max number of indices
  if (!(indices.length > 0 && indices.length <= MAX_VALIDATORS_PER_COMMITTEE)) {
    return false;
  }
  // verify indices are sorted and unique.
  // Just check if they are monotonically increasing,
  // instead of creating a set and sorting it. Should be (O(n)) instead of O(n log(n))
  let prev = -1;
  for (const index of indices) {
    if (index <= prev) return false;
    prev = index;
  }
  // check if indices are out of bounds, by checking the highest index (since it is sorted)
  if (indices[indices.length - 1] >= cachedState.validators.length) {
    return false;
  }
  // verify aggregate signature
  if (!verifySignature) {
    return true;
  }

  const signatureSet = getIndexedAttestationSignatureSet(cachedState, indexedAttestation, indices);
  try {
    return verifySignatureSet(signatureSet);
  } catch (e) {
    return false;
  }
}

export function getIndexedAttestationSignatureSet(
  cachedState: CachedBeaconState,
  indexedAttestation: IndexedAttestation,
  indices?: number[]
): ISignatureSet {
  const config = cachedState.config;
  const domain = getDomain(config, cachedState, DomainType.BEACON_ATTESTER, indexedAttestation.data.target.epoch);

  if (!indices) indices = getIndices(indexedAttestation);
  return {
    type: SignatureSetType.aggregate,
    pubkeys: indices.map((i) => cachedState.index2pubkey[i]),
    signingRoot: computeSigningRoot(config, config.types.AttestationData, indexedAttestation.data, domain),
    signature: indexedAttestation.signature.valueOf() as Uint8Array,
  };
}

function getIndices(indexedAttestation: IndexedAttestation): number[] {
  return Array.from(indexedAttestation.attestingIndices);
}
