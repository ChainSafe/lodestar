import {BeaconConfig} from "@lodestar/config";
import {ForkSeq, MAX_COMMITTEES_PER_SLOT, MAX_VALIDATORS_PER_COMMITTEE} from "@lodestar/params";
import {IndexedAttestation, IndexedAttestationBigint, Slot} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {getIndexedAttestationBigintSignatureSet, getIndexedAttestationSignatureSet} from "../signatureSets/index.js";
import {verifySignatureSet} from "../util/index.js";

/**
 * Check if `indexedAttestation` has sorted and unique indices and a valid aggregate signature.
 */
export function isValidIndexedAttestation(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  stateSlot: Slot,
  validatorsLen: number,
  indexedAttestation: IndexedAttestation,
  verifySignature: boolean
): boolean {
  if (!isValidIndexedAttestationIndices(config, stateSlot, validatorsLen, indexedAttestation.attestingIndices)) {
    return false;
  }

  if (verifySignature) {
    return verifySignatureSet(getIndexedAttestationSignatureSet(config, stateSlot, indexedAttestation), index2pubkey);
  }
  return true;
}

export function isValidIndexedAttestationBigint(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  stateSlot: Slot,
  validatorsLen: number,
  indexedAttestation: IndexedAttestationBigint,
  verifySignature: boolean
): boolean {
  if (!isValidIndexedAttestationIndices(config, stateSlot, validatorsLen, indexedAttestation.attestingIndices)) {
    return false;
  }

  if (verifySignature) {
    return verifySignatureSet(
      getIndexedAttestationBigintSignatureSet(config, stateSlot, indexedAttestation),
      index2pubkey
    );
  }
  return true;
}

/**
 * Check if `indexedAttestation` has sorted and unique indices and a valid aggregate signature.
 */
export function isValidIndexedAttestationIndices(
  config: BeaconConfig,
  stateSlot: Slot,
  validatorsLen: number,
  indices: number[]
): boolean {
  // verify max number of indices
  const maxIndices =
    config.getForkSeq(stateSlot) >= ForkSeq.electra
      ? MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT
      : MAX_VALIDATORS_PER_COMMITTEE;
  if (!(indices.length > 0 && indices.length <= maxIndices)) {
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
  const lastIndex = indices.at(-1);
  if (lastIndex && lastIndex >= validatorsLen) {
    return false;
  }

  return true;
}
