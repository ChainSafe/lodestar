import {altair, ValidatorIndex} from "@chainsafe/lodestar-types";
import {readonlyValues, toHexString} from "@chainsafe/ssz";
import {PubkeyIndexMap} from "./pubkeyCache";

type SyncComitteeValidatorIndexMap = Map<ValidatorIndex, number[]>;

export type SyncCommitteeCache = {
  /**
   * Update freq: every ~ 27h.
   * Memory cost: 512 Number integers.
   */
  validatorIndices: ValidatorIndex[];
  /**
   * Update freq: every ~ 27h.
   * Memory cost: Map of Number -> Number with 512 entries.
   */
  validatorIndexMap: SyncComitteeValidatorIndexMap;
};

/** Placeholder object for pre-altair fork */
export class SyncCommitteeCacheEmpty implements SyncCommitteeCache {
  get validatorIndices(): ValidatorIndex[] {
    throw Error("Empty SyncCommitteeCache");
  }

  get validatorIndexMap(): SyncComitteeValidatorIndexMap {
    throw Error("Empty SyncCommitteeCache");
  }
}

export function getSyncCommitteeCache(validatorIndices: ValidatorIndex[]): SyncCommitteeCache {
  return {
    validatorIndices,
    validatorIndexMap: computeSyncComitteeMap(validatorIndices),
  };
}

export function computeSyncCommitteeCache(
  syncCommittee: altair.SyncCommittee,
  pubkey2index: PubkeyIndexMap
): SyncCommitteeCache {
  const validatorIndices = computeSyncCommitteeIndices(syncCommittee, pubkey2index);
  const validatorIndexMap = computeSyncComitteeMap(validatorIndices);
  return {
    validatorIndices,
    validatorIndexMap,
  };
}

/**
 * Compute all index in sync committee for all validatorIndexes in `syncCommitteeIndexes`.
 * Helps reduce work necessary to verify a validatorIndex belongs in a sync committee and which.
 * This is similar to compute_subnets_for_sync_committee in https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/validator.md
 */
export function computeSyncComitteeMap(syncCommitteeIndexes: ValidatorIndex[]): SyncComitteeValidatorIndexMap {
  const map = new Map<ValidatorIndex, number[]>();

  for (let i = 0, len = syncCommitteeIndexes.length; i < len; i++) {
    const validatorIndex = syncCommitteeIndexes[i];
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
function computeSyncCommitteeIndices(
  syncCommittee: altair.SyncCommittee,
  pubkey2index: PubkeyIndexMap
): ValidatorIndex[] {
  const validatorIndices: ValidatorIndex[] = [];
  const pubkeys = readonlyValues(syncCommittee.pubkeys);
  for (const pubkey of pubkeys) {
    const validatorIndex = pubkey2index.get(pubkey.valueOf() as typeof pubkey);
    if (validatorIndex === undefined) {
      throw Error(`SyncCommittee pubkey is unknown ${toHexString(pubkey)}`);
    }

    validatorIndices.push(validatorIndex);
  }

  return validatorIndices;
}
