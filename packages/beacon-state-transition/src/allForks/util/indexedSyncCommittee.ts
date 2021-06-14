import {altair, phase0} from "@chainsafe/lodestar-types";
import {Vector} from "@chainsafe/ssz";
import {PubkeyIndexMap} from "./epochContext";

type SyncComitteeValidatorIndexMap = Map<phase0.ValidatorIndex, number[]>;
/**
 * Same to altair.SyncCommittee with additional indexed properties.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface IndexedSyncCommittee extends altair.SyncCommittee {
  pubkeys: Vector<phase0.BLSPubkey>;
  aggregatePubkey: phase0.BLSPubkey;
  /**
   * Update freq: every ~ 54h.
   * Memory cost: 1024 Number integers.
   */
  validatorIndices: phase0.ValidatorIndex[];
  /**
   * Update freq: every ~ 54h.
   * Memory cost: Map of Number -> Number with 1024 entries.
   */
  validatorIndexMap: SyncComitteeValidatorIndexMap;
}

export function createIndexedSyncCommittee(
  pubkey2index: PubkeyIndexMap,
  state: altair.BeaconState,
  isNext: boolean
): IndexedSyncCommittee {
  const syncCommittee = isNext ? state.nextSyncCommittee : state.currentSyncCommittee;
  return convertToIndexedSyncCommittee(syncCommittee, pubkey2index);
}

export function convertToIndexedSyncCommittee(
  syncCommittee: altair.SyncCommittee,
  pubkey2index: PubkeyIndexMap
): IndexedSyncCommittee {
  const validatorIndices = computeSyncCommitteeIndices(syncCommittee, pubkey2index);
  const validatorIndexMap = computeSyncComitteeMap(validatorIndices);
  return {
    pubkeys: syncCommittee.pubkeys,
    aggregatePubkey: syncCommittee.aggregatePubkey,
    validatorIndices,
    validatorIndexMap,
  };
}

/**
 * Compute all index in sync committee for all validatorIndexes in `syncCommitteeIndexes`.
 * Helps reduce work necessary to verify a validatorIndex belongs in a sync committee and which.
 * This is similar to compute_subnets_for_sync_committee in https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/validator.md
 */
export function computeSyncComitteeMap(syncCommitteeIndexes: phase0.ValidatorIndex[]): SyncComitteeValidatorIndexMap {
  const map = new Map<phase0.ValidatorIndex, number[]>();

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
): phase0.ValidatorIndex[] {
  const result: phase0.ValidatorIndex[] = [];
  for (const pubkey of syncCommittee.pubkeys) {
    const validatorIndex = pubkey2index.get(pubkey.valueOf() as Uint8Array);
    if (validatorIndex !== undefined) {
      result.push(validatorIndex);
    }
  }
  return result;
}
