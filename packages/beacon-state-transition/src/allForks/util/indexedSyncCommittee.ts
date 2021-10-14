import {altair, ssz, allForks, Slot, ValidatorIndex, BLSPubkey} from "@chainsafe/lodestar-types";
import {TreeBacked, Vector} from "@chainsafe/ssz";
import {computeSyncPeriodAtSlot} from "../../util/epoch";
import {CachedBeaconState} from "./cachedBeaconState";
import {PubkeyIndexMap} from "./epochContext";

type SyncComitteeValidatorIndexMap = Map<ValidatorIndex, number[]>;

/**
 * A sync committee with additional index data.
 *
 * TODO: Rename to CachedSyncCommittee for consistency with other structures
 */
export class IndexedSyncCommittee implements altair.SyncCommittee {
  treeBacked: TreeBacked<altair.SyncCommittee>;
  pubkeys: Vector<BLSPubkey>;
  aggregatePubkey: BLSPubkey;
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

  constructor(
    treeBacked: TreeBacked<altair.SyncCommittee>,
    validatorIndices: ValidatorIndex[],
    validatorIndexMap: SyncComitteeValidatorIndexMap
  ) {
    this.treeBacked = treeBacked;
    this.pubkeys = treeBacked.pubkeys;
    this.aggregatePubkey = treeBacked.aggregatePubkey;
    this.validatorIndices = validatorIndices;
    this.validatorIndexMap = validatorIndexMap;
  }

  /**
   * clone() shares the same index data.
   */
  clone(): IndexedSyncCommittee {
    return new IndexedSyncCommittee(this.treeBacked.clone(), this.validatorIndices, this.validatorIndexMap);
  }
}

export const emptyIndexedSyncCommittee = new IndexedSyncCommittee(
  ssz.altair.SyncCommittee.defaultTreeBacked(),
  [],
  new Map()
);

export function createIndexedSyncCommittee(
  pubkey2index: PubkeyIndexMap,
  state: TreeBacked<altair.BeaconState>,
  isNext: boolean
): IndexedSyncCommittee {
  const syncCommittee = isNext ? state.nextSyncCommittee : state.currentSyncCommittee;
  return convertToIndexedSyncCommittee(syncCommittee as TreeBacked<altair.SyncCommittee>, pubkey2index);
}

export function convertToIndexedSyncCommittee(
  syncCommittee: TreeBacked<altair.SyncCommittee>,
  pubkey2index: PubkeyIndexMap
): IndexedSyncCommittee {
  const validatorIndices = computeSyncCommitteeIndices(syncCommittee, pubkey2index);
  const validatorIndexMap = computeSyncComitteeMap(validatorIndices);
  return new IndexedSyncCommittee(syncCommittee, validatorIndices, validatorIndexMap);
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
  const result: ValidatorIndex[] = [];
  for (const pubkey of syncCommittee.pubkeys) {
    const validatorIndex = pubkey2index.get(pubkey.valueOf() as Uint8Array);
    if (validatorIndex !== undefined) {
      result.push(validatorIndex);
    }
  }
  return result;
}

/**
 * Note: The range of slots a validator has to perform duties is off by one.
 * The previous slot wording means that if your validator is in a sync committee for a period that runs from slot
 * 100 to 200,then you would actually produce signatures in slot 99 - 199.
 */
export function getIndexedSyncCommittee(
  state: CachedBeaconState<allForks.BeaconState> | CachedBeaconState<altair.BeaconState>,
  slot: Slot
): IndexedSyncCommittee {
  const statePeriod = computeSyncPeriodAtSlot(state.slot);
  const slotPeriod = computeSyncPeriodAtSlot(slot + 1); // See note above for the +1 offset
  if (slotPeriod === statePeriod) {
    return state.currentSyncCommittee;
  } else if (slotPeriod === statePeriod + 1) {
    return state.nextSyncCommittee;
  } else {
    throw new Error(`State ${state.slot} does not contain sync committee for slot ${slot}`);
  }
}
