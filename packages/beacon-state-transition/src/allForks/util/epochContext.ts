import {ByteVector, hash, toHexString, BitList, List, readonlyValues} from "@chainsafe/ssz";
import bls, {CoordType, PublicKey} from "@chainsafe/bls";
import {BLSSignature, CommitteeIndex, Epoch, Slot, ValidatorIndex, phase0, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {
  DOMAIN_BEACON_PROPOSER,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  GENESIS_EPOCH,
  SLOTS_PER_EPOCH,
} from "@chainsafe/lodestar-params";

import {
  computeEpochAtSlot,
  computeProposerIndex,
  computeStartSlotAtEpoch,
  getAttestingIndicesFromCommittee,
  getSeed,
  isAggregatorFromCommitteeLength,
} from "../../util";
import {getSyncCommitteeIndices} from "../../altair/state_accessor/sync_committee";
import {computeEpochShuffling, IEpochShuffling} from "./epochShuffling";
import {MutableVector} from "@chainsafe/persistent-ts";
import {CachedValidatorList} from "./cachedValidatorList";

export type EpochContextOpts = {
  pubkey2index?: PubkeyIndexMap;
  index2pubkey?: PublicKey[];
  skipSyncPubkeys?: boolean;
};

export class PubkeyIndexMap extends Map<ByteVector, ValidatorIndex> {
  get(key: ByteVector): ValidatorIndex | undefined {
    return super.get((toHexString(key) as unknown) as ByteVector);
  }
  set(key: ByteVector, value: ValidatorIndex): this {
    return super.set((toHexString(key) as unknown) as ByteVector, value);
  }
}

/**
 * Create an epoch cache
 * @param validators cached validators that matches `state.validators`
 */
export function createEpochContext(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  validators: MutableVector<phase0.Validator>,
  opts?: EpochContextOpts
): EpochContext {
  const pubkey2index = opts?.pubkey2index || new PubkeyIndexMap();
  const index2pubkey = opts?.index2pubkey || ([] as PublicKey[]);
  if (!opts?.skipSyncPubkeys) {
    syncPubkeys(state, pubkey2index, index2pubkey);
  }

  const currentEpoch = computeEpochAtSlot(state.slot);
  const previousEpoch = currentEpoch === GENESIS_EPOCH ? GENESIS_EPOCH : currentEpoch - 1;
  const nextEpoch = currentEpoch + 1;

  const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = validators.map((v, i) => [
    i,
    v.activationEpoch,
    v.exitEpoch,
  ]);

  const currentShuffling = computeEpochShuffling(state, indicesBounded, currentEpoch);
  let previousShuffling;
  if (previousEpoch === currentEpoch) {
    // in case of genesis
    previousShuffling = currentShuffling;
  } else {
    previousShuffling = computeEpochShuffling(state, indicesBounded, previousEpoch);
  }
  const nextShuffling = computeEpochShuffling(state, indicesBounded, nextEpoch);
  const proposers = computeProposers(state, currentShuffling);

  // Only after altair, compute the indices of the current sync committee
  const onAltairFork = currentEpoch >= config.ALTAIR_FORK_EPOCH;
  const nextPeriodEpoch = currentEpoch + EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
  const currSyncCommitteeIndexes = onAltairFork ? getSyncCommitteeIndices(state, currentEpoch) : [];
  const nextSyncCommitteeIndexes = onAltairFork ? getSyncCommitteeIndices(state, nextPeriodEpoch) : [];

  return new EpochContext({
    config,
    pubkey2index,
    index2pubkey,
    proposers,
    previousShuffling,
    currentShuffling,
    nextShuffling,
    currSyncCommitteeIndexes,
    nextSyncCommitteeIndexes,
    currSyncComitteeValidatorIndexMap: computeSyncComitteeMap(currSyncCommitteeIndexes),
    nextSyncComitteeValidatorIndexMap: computeSyncComitteeMap(nextSyncCommitteeIndexes),
  });
}

/**
 * Checks the pubkey indices against a state and adds missing pubkeys
 *
 * Mutates `pubkey2index` and `index2pubkey`
 */
export function syncPubkeys(
  state: allForks.BeaconState,
  pubkey2index: PubkeyIndexMap,
  index2pubkey: PublicKey[]
): void {
  const currentCount = pubkey2index.size;
  if (currentCount !== index2pubkey.length) {
    throw new Error(`Pubkey indices have fallen out of sync: ${currentCount} != ${index2pubkey.length}`);
  }
  const newCount = state.validators.length;
  for (let i = currentCount; i < newCount; i++) {
    const pubkey = state.validators[i].pubkey.valueOf() as Uint8Array;
    pubkey2index.set(pubkey, i);
    // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed.
    // Afterwards any public key is the state consider validated.
    // > Do not do any validation here
    index2pubkey.push(bls.PublicKey.fromBytes(pubkey, CoordType.jacobian)); // Optimize for aggregation
  }
}

/**
 * Compute proposer indices for an epoch
 */
export function computeProposers(state: allForks.BeaconState, shuffling: IEpochShuffling): number[] {
  const epochSeed = getSeed(state, shuffling.epoch, DOMAIN_BEACON_PROPOSER);
  const startSlot = computeStartSlotAtEpoch(shuffling.epoch);
  const proposers = [];
  for (let slot = startSlot; slot < startSlot + SLOTS_PER_EPOCH; slot++) {
    proposers.push(
      computeProposerIndex(state, shuffling.activeIndices, hash(Buffer.concat([epochSeed, intToBytes(slot, 8)])))
    );
  }
  return proposers;
}

/**
 * Compute all index in sync committee for all validatorIndexes in `syncCommitteeIndexes`.
 * Helps reduce work necessary to verify a validatorIndex belongs in a sync committee and which.
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
    indexes.push(i);
  }

  return map;
}

/**
 * Called to re-use information, such as the shuffling of the next epoch, after transitioning into a
 * new epoch.
 */
export function rotateEpochs(
  epochCtx: EpochContext,
  state: allForks.BeaconState,
  validators: CachedValidatorList<phase0.Validator>
): void {
  epochCtx.previousShuffling = epochCtx.currentShuffling;
  epochCtx.currentShuffling = epochCtx.nextShuffling;
  const currEpoch = epochCtx.currentShuffling.epoch;
  const nextEpoch = currEpoch + 1;
  const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = validators.map((v, i) => [
    i,
    v.activationEpoch,
    v.exitEpoch,
  ]);
  epochCtx.nextShuffling = computeEpochShuffling(state, indicesBounded, nextEpoch);
  epochCtx.proposers = computeProposers(state, epochCtx.currentShuffling);

  // State slot has already been += 1
  if (currEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0 && currEpoch > epochCtx.config.ALTAIR_FORK_EPOCH) {
    const nextPeriodEpoch = currEpoch + EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
    epochCtx.currSyncCommitteeIndexes = epochCtx.nextSyncCommitteeIndexes;
    epochCtx.nextSyncCommitteeIndexes = getSyncCommitteeIndices(state, nextPeriodEpoch);
    epochCtx.currSyncComitteeValidatorIndexMap = epochCtx.nextSyncComitteeValidatorIndexMap;
    epochCtx.nextSyncComitteeValidatorIndexMap = computeSyncComitteeMap(epochCtx.nextSyncCommitteeIndexes);
  }

  // If crossing through the altair fork the caches will be empty, fill them up
  if (currEpoch === epochCtx.config.ALTAIR_FORK_EPOCH) {
    const nextPeriodEpoch = currEpoch + EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
    epochCtx.currSyncCommitteeIndexes = getSyncCommitteeIndices(state, currEpoch);
    epochCtx.nextSyncCommitteeIndexes = getSyncCommitteeIndices(state, nextPeriodEpoch);
    epochCtx.currSyncComitteeValidatorIndexMap = computeSyncComitteeMap(epochCtx.currSyncCommitteeIndexes);
    epochCtx.nextSyncComitteeValidatorIndexMap = computeSyncComitteeMap(epochCtx.nextSyncCommitteeIndexes);
  }
}

type SyncComitteeValidatorIndexMap = Map<ValidatorIndex, number[]>;
interface IEpochContextData {
  config: IBeaconConfig;
  pubkey2index: PubkeyIndexMap;
  index2pubkey: PublicKey[];
  proposers: number[];
  previousShuffling: IEpochShuffling;
  currentShuffling: IEpochShuffling;
  nextShuffling: IEpochShuffling;
  currSyncCommitteeIndexes: ValidatorIndex[];
  nextSyncCommitteeIndexes: ValidatorIndex[];
  currSyncComitteeValidatorIndexMap: SyncComitteeValidatorIndexMap;
  nextSyncComitteeValidatorIndexMap: SyncComitteeValidatorIndexMap;
}

/**
 * The standard / Exchange Interface of EpochContext, this is what's exported from
 * lodestar-beacon-state-transition.
 * A collection of contextual information to re-use during an epoch, and rotating precomputed data of
 * the next epoch into the current epoch. This includes shuffling, but also proposer information is
 * available.
 **/
export class EpochContext {
  // TODO: this is a hack, we need a safety mechanism in case a bad eth1 majority vote is in,
  // or handle non finalized data differently, or use an immutable.js structure for cheap copies
  // Warning: may contain pubkeys that do not yet exist in the current state, but do in a later processed state.
  pubkey2index: PubkeyIndexMap;
  // Warning: may contain indices that do not yet exist in the current state, but do in a later processed state.
  index2pubkey: PublicKey[];
  proposers: number[];
  // Per spec definition, shuffling will always be defined. They are never called before loadState()
  previousShuffling: IEpochShuffling;
  currentShuffling: IEpochShuffling;
  nextShuffling: IEpochShuffling;
  /**
   * Update freq: every ~ 27h.
   * Memory cost: 1024 Number integers.
   */
  currSyncCommitteeIndexes: ValidatorIndex[];
  nextSyncCommitteeIndexes: ValidatorIndex[];
  /**
   * Update freq: every ~ 27h.
   * Memory cost: Map of Number -> Number with 1024 entries.
   */
  currSyncComitteeValidatorIndexMap: SyncComitteeValidatorIndexMap;
  nextSyncComitteeValidatorIndexMap: SyncComitteeValidatorIndexMap;
  config: IBeaconConfig;

  constructor(data: IEpochContextData) {
    this.config = data.config;
    this.pubkey2index = data.pubkey2index;
    this.index2pubkey = data.index2pubkey;
    this.proposers = data.proposers;
    this.previousShuffling = data.previousShuffling;
    this.currentShuffling = data.currentShuffling;
    this.nextShuffling = data.nextShuffling;
    this.currSyncCommitteeIndexes = data.currSyncCommitteeIndexes;
    this.nextSyncCommitteeIndexes = data.nextSyncCommitteeIndexes;
    this.currSyncComitteeValidatorIndexMap = data.currSyncComitteeValidatorIndexMap;
    this.nextSyncComitteeValidatorIndexMap = data.nextSyncComitteeValidatorIndexMap;
  }

  /**
   * Copies a given EpochContext while avoiding copying its immutable parts.
   */
  copy(): EpochContext {
    // warning: pubkey cache is not copied, it is shared, as eth1 is not expected to reorder validators.
    // Shallow copy all data from current epoch context to the next
    // All data is completely replaced, or only-appended
    return new EpochContext(this);
  }

  /**
   * Return the beacon committee at slot for index.
   */
  getBeaconCommittee(slot: Slot, index: CommitteeIndex): ValidatorIndex[] {
    const slotCommittees = this._getSlotCommittees(slot);
    if (index >= slotCommittees.length) {
      throw new Error(`Requesting beacon committee index ${index} over slot committees len ${slotCommittees.length}`);
    }
    return slotCommittees[index];
  }

  getCommitteeCountAtSlot(slot: Slot): number {
    return this._getSlotCommittees(slot).length;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    const epoch = computeEpochAtSlot(slot);
    if (epoch !== this.currentShuffling.epoch) {
      throw new Error(
        `Requesting beacon proposer for different epoch current shuffling: ${epoch} != ${this.currentShuffling.epoch}`
      );
    }
    return this.proposers[slot % SLOTS_PER_EPOCH];
  }

  /**
   * Return the indexed attestation corresponding to ``attestation``.
   */
  getIndexedAttestation(attestation: phase0.Attestation): phase0.IndexedAttestation {
    const data = attestation.data;
    const bits = Array.from(readonlyValues(attestation.aggregationBits));
    const committee = this.getBeaconCommittee(data.slot, data.index);
    // No need for a Set, the indices in the committee are already unique.
    const attestingIndices: ValidatorIndex[] = [];
    for (const [i, index] of committee.entries()) {
      if (bits[i]) {
        attestingIndices.push(index);
      }
    }
    // sort in-place
    attestingIndices.sort((a, b) => a - b);
    return {
      attestingIndices: attestingIndices as List<number>,
      data: data,
      signature: attestation.signature,
    };
  }

  getAttestingIndices(data: phase0.AttestationData, bits: BitList): ValidatorIndex[] {
    const committee = this.getBeaconCommittee(data.slot, data.index);
    return getAttestingIndicesFromCommittee(committee, Array.from(readonlyValues(bits)) as List<boolean>);
  }

  /**
   * Return the committee assignment in the ``epoch`` for ``validator_index``.
   * ``assignment`` returned is a tuple of the following form:
   * ``assignment[0]`` is the list of validators in the committee
   * ``assignment[1]`` is the index to which the committee is assigned
   * ``assignment[2]`` is the slot at which the committee is assigned
   * Return null if no assignment..
   */
  getCommitteeAssignment(epoch: Epoch, validatorIndex: ValidatorIndex): phase0.CommitteeAssignment | null {
    if (epoch > this.currentShuffling.epoch + 1) {
      throw Error(
        `Requesting committee assignment for more than 1 epoch ahead: ${epoch} > ${this.currentShuffling.epoch} + 1`
      );
    }

    const epochStartSlot = computeStartSlotAtEpoch(epoch);
    for (let slot = epochStartSlot; slot < epochStartSlot + SLOTS_PER_EPOCH; slot++) {
      const committeeCount = this.getCommitteeCountAtSlot(slot);
      for (let i = 0; i < committeeCount; i++) {
        const committee = this.getBeaconCommittee(slot, i);
        if (committee.includes(validatorIndex)) {
          return {
            validators: committee as List<number>,
            committeeIndex: i,
            slot,
          };
        }
      }
    }

    return null;
  }

  isAggregator(slot: Slot, index: CommitteeIndex, slotSignature: BLSSignature): boolean {
    const committee = this.getBeaconCommittee(slot, index);
    return isAggregatorFromCommitteeLength(committee.length, slotSignature);
  }

  addPubkey(index: ValidatorIndex, pubkey: Uint8Array): void {
    this.pubkey2index.set(pubkey, index);
    this.index2pubkey[index] = bls.PublicKey.fromBytes(pubkey, CoordType.jacobian); // Optimize for aggregation
  }

  private _getSlotCommittees(slot: Slot): ValidatorIndex[][] {
    const epoch = computeEpochAtSlot(slot);
    const epochSlot = slot % SLOTS_PER_EPOCH;
    if (epoch === this.previousShuffling.epoch) {
      return this.previousShuffling.committees[epochSlot];
    } else if (epoch === this.currentShuffling.epoch) {
      return this.currentShuffling.committees[epochSlot];
    } else if (epoch === this.nextShuffling.epoch) {
      return this.nextShuffling.committees[epochSlot];
    } else {
      throw new Error(`Requesting slot committee out of range epoch: ${epoch} current: ${this.currentShuffling.epoch}`);
    }
  }
}
