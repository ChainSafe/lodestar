import {BeaconState, IndexedAttestation} from "@chainsafe/lodestar-types";
import {DomainType} from "../../constants";
import {computeSigningRoot, getDomain} from "../../util";
import {ISignatureSet, verifySignatureSet} from "../signatureSets";
import {EpochContext} from "../util";

export function isValidIndexedAttestation(
  epochCtx: EpochContext,
  state: BeaconState,
  indexedAttestation: IndexedAttestation,
  verifySignature = true
): boolean {
  const config = epochCtx.config;
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
  if (indices[indices.length - 1] >= state.validators.length) {
    return false;
  }
  // verify aggregate signature
  if (!verifySignature) {
    return true;
  }

  const signatureSet = getIndexedAttestationSignatureSet(epochCtx, state, indexedAttestation, indices);
  try {
    return verifySignatureSet(signatureSet);
  } catch (e) {
    return false;
  }
}

export function getIndexedAttestationSignatureSet(
  epochCtx: EpochContext,
  state: BeaconState,
  indexedAttestation: IndexedAttestation,
  indices?: number[]
): ISignatureSet {
  const config = epochCtx.config;
  const domain = getDomain(config, state, DomainType.BEACON_ATTESTER, indexedAttestation.data.target.epoch);

  // TODO: Should the indexes be sorted for signature validation?
  if (!indices) indices = getIndices(indexedAttestation);
  return {
    type: "multiple-pubkeys",
    pubkeys: indices.map((i) => epochCtx.index2pubkey[i]),
    signingRoot: computeSigningRoot(config, config.types.AttestationData, indexedAttestation.data, domain),
    signature: indexedAttestation.signature.valueOf() as Uint8Array,
  };
}

function getIndices(indexedAttestation: IndexedAttestation): number[] {
  return Array.from(indexedAttestation.attestingIndices);
}
