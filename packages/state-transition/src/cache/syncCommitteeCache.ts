import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {CompositeViewDU} from "@chainsafe/ssz";
import {ValidatorIndex, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";

type ValidatorSyncCommitteeIndexMap = Map<ValidatorIndex, number[]>;

export type SyncCommitteeCache = {
  /**
   * Update freq: every ~ 27h.
   * Memory cost: 512 Number integers.
   */
  validatorIndices: Uint32Array;
  /**
   * Update freq: every ~ 27h.
   * Memory cost: Map of Number -> Number with 512 entries.
   * Note: it stores the position indices in sync committee for each sync committee validator
   */
  validatorIndexMap: ValidatorSyncCommitteeIndexMap;
};

/** Placeholder object for pre-altair fork */
export class SyncCommitteeCacheEmpty implements SyncCommitteeCache {
  get validatorIndices(): Uint32Array {
    throw Error("Empty SyncCommitteeCache");
  }

  get validatorIndexMap(): ValidatorSyncCommitteeIndexMap {
    throw Error("Empty SyncCommitteeCache");
  }
}

export function getSyncCommitteeCache(validatorIndices: Uint32Array): SyncCommitteeCache {
  return {
    validatorIndices,
    validatorIndexMap: computeValidatorSyncCommitteeIndexMap(validatorIndices),
  };
}

export function computeSyncCommitteeCache(
  syncCommittee: CompositeViewDU<typeof ssz.altair.SyncCommittee>,
  pubkey2index: PubkeyIndexMap
): SyncCommitteeCache {
  const validatorIndices = computeSyncCommitteeValidatorIndices(syncCommittee, pubkey2index);
  const validatorIndexMap = computeValidatorSyncCommitteeIndexMap(validatorIndices);
  return {
    validatorIndices,
    validatorIndexMap,
  };
}

/**
 * Compute all position index in sync committee for all validatorIndexes in `syncCommitteeIndexes`.
 * Helps reduce work necessary to verify a validatorIndex belongs in a sync committee and which.
 * This is similar to compute_subnets_for_sync_committee in https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/validator.md
 */
export function computeValidatorSyncCommitteeIndexMap(
  validatorIndices: ArrayLike<ValidatorIndex>
): ValidatorSyncCommitteeIndexMap {
  const map = new Map<ValidatorIndex, number[]>();

  for (let i = 0, len = validatorIndices.length; i < len; i++) {
    const validatorIndex = validatorIndices[i];
    let indexes = map.get(validatorIndex);
    if (!indexes) {
      indexes = [];
      map.set(validatorIndex, indexes);
    }
    if (!indexes.includes(i)) {
      indexes.push(i);
    }
  }

  return map;
}

/**
 * Extract validator indices from current and next sync committee
 */
function computeSyncCommitteeValidatorIndices(
  syncCommittee: CompositeViewDU<typeof ssz.altair.SyncCommittee>,
  pubkey2index: PubkeyIndexMap
): Uint32Array {
  const pubkeys = syncCommittee.pubkeys.getAllReadonly();
  const validatorIndices = new Uint32Array(pubkeys.length);
  for (const [i, pubkey] of pubkeys.entries()) {
    const validatorIndex = pubkey2index.get(pubkey);
    if (validatorIndex === null) {
      throw Error(`SyncCommittee pubkey is unknown ${toPubkeyHex(pubkey)}`);
    }

    validatorIndices[i] = validatorIndex;
  }

  return validatorIndices;
}
