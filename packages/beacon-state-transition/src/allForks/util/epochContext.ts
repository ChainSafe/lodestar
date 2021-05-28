import {ByteVector, hash, toHexString, BitList, List, isTreeBacked, TreeBacked} from "@chainsafe/ssz";
import bls, {CoordType, PublicKey} from "@chainsafe/bls";
import {
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Slot,
  ValidatorIndex,
  phase0,
  allForks,
  altair,
  Gwei,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bigIntSqrt, intToBytes} from "@chainsafe/lodestar-utils";

import {GENESIS_EPOCH} from "../../constants";
import {
  computeEpochAtSlot,
  computeProposerIndex,
  computeStartSlotAtEpoch,
  getSeed,
  getTotalActiveBalance,
  isAggregatorFromCommitteeLength,
  zipIndexesInBitList,
} from "../../util";
import {getNextSyncCommitteeIndices} from "../../altair/state_accessor/sync_committee";
import {computeEpochShuffling, IEpochShuffling} from "./epochShuffling";
import {MutableVector} from "@chainsafe/persistent-ts";
import {CachedValidatorList} from "./cachedValidatorList";
import {PROPOSER_WEIGHT, SYNC_REWARD_WEIGHT, WEIGHT_DENOMINATOR} from "../../altair/constants";

export type EpochContextOpts = {
  pubkey2index?: PubkeyIndexMap;
  index2pubkey?: PublicKey[];
  skipSyncPubkeys?: boolean;
};

type PubkeyHex = string;

function toHexStringMaybe(hex: ByteVector | string): string {
  return typeof hex === "string" ? hex : toHexString(hex);
}

export class PubkeyIndexMap {
  private readonly map = new Map<PubkeyHex, ValidatorIndex>();

  get size(): number {
    return this.map.size;
  }

  get(key: ByteVector | PubkeyHex): ValidatorIndex | undefined {
    return this.map.get(toHexStringMaybe(key));
  }

  set(key: ByteVector | PubkeyHex, value: ValidatorIndex): void {
    this.map.set(toHexStringMaybe(key), value);
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

  const currentEpoch = computeEpochAtSlot(config, state.slot);
  const previousEpoch = currentEpoch === GENESIS_EPOCH ? GENESIS_EPOCH : currentEpoch - 1;
  const nextEpoch = currentEpoch + 1;

  const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = validators.map((v, i) => [
    i,
    v.activationEpoch,
    v.exitEpoch,
  ]);

  const currentShuffling = computeEpochShuffling(config, state, indicesBounded, currentEpoch);
  let previousShuffling;
  if (previousEpoch === currentEpoch) {
    // in case of genesis
    previousShuffling = currentShuffling;
  } else {
    previousShuffling = computeEpochShuffling(config, state, indicesBounded, previousEpoch);
  }
  const nextShuffling = computeEpochShuffling(config, state, indicesBounded, nextEpoch);
  const proposers = computeProposers(config, state, currentShuffling);

  // Only after altair, compute the indices of the current sync committee
  const onAltairFork = currentEpoch >= config.params.ALTAIR_FORK_EPOCH;
  const currSyncCommitteeIndexes = onAltairFork
    ? computeSyncCommitteeIndices(pubkey2index, state as altair.BeaconState, false)
    : [];
  const nextSyncCommitteeIndexes = onAltairFork
    ? computeSyncCommitteeIndices(pubkey2index, state as altair.BeaconState, true)
    : [];

  const syncParticipantReward = onAltairFork ? computeSyncParticipantReward(config, state) : BigInt(0);
  const syncProposerReward = onAltairFork
    ? (syncParticipantReward * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT)
    : BigInt(0);

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
    syncParticipantReward,
    syncProposerReward,
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
export function computeProposers(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  shuffling: IEpochShuffling
): number[] {
  const epochSeed = getSeed(config, state, shuffling.epoch, config.params.DOMAIN_BEACON_PROPOSER);
  const startSlot = computeStartSlotAtEpoch(config, shuffling.epoch);
  const proposers = [];
  for (let slot = startSlot; slot < startSlot + config.params.SLOTS_PER_EPOCH; slot++) {
    proposers.push(
      computeProposerIndex(
        config,
        state,
        shuffling.activeIndices,
        hash(Buffer.concat([epochSeed, intToBytes(slot, 8)]))
      )
    );
  }
  return proposers;
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
export function computeSyncCommitteeIndices(
  pubkey2index: PubkeyIndexMap,
  state: altair.BeaconState,
  isNext: boolean
): phase0.ValidatorIndex[] {
  const syncCommittee = isNext ? state.nextSyncCommittee : state.currentSyncCommittee;
  const result: phase0.ValidatorIndex[] = [];
  for (const pubkey of syncCommittee.pubkeys) {
    const validatorIndex = pubkey2index.get(pubkey.valueOf() as Uint8Array);
    if (validatorIndex !== undefined) {
      result.push(validatorIndex);
    }
  }
  return result;
}

/**
 * Same logic in https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#sync-committee-processing
 */
export function computeSyncParticipantReward(config: IBeaconConfig, state: allForks.BeaconState): Gwei {
  const {EFFECTIVE_BALANCE_INCREMENT, BASE_REWARD_FACTOR, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} = config.params;
  const totalActiveBalance = getTotalActiveBalance(config, state);
  const totalActiveIncrements = totalActiveBalance / EFFECTIVE_BALANCE_INCREMENT;
  const baseRewardPerIncrement =
    (EFFECTIVE_BALANCE_INCREMENT * BigInt(BASE_REWARD_FACTOR)) / bigIntSqrt(totalActiveBalance);
  const totalBaseRewards = baseRewardPerIncrement * totalActiveIncrements;
  const maxParticipantRewards = (totalBaseRewards * SYNC_REWARD_WEIGHT) / WEIGHT_DENOMINATOR / BigInt(SLOTS_PER_EPOCH);
  return maxParticipantRewards / BigInt(SYNC_COMMITTEE_SIZE);
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
  epochCtx.nextShuffling = computeEpochShuffling(epochCtx.config, state, indicesBounded, nextEpoch);
  epochCtx.proposers = computeProposers(epochCtx.config, state, epochCtx.currentShuffling);

  // State slot has already been += 1
  if (
    currEpoch % epochCtx.config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD === 0 &&
    currEpoch > epochCtx.config.params.ALTAIR_FORK_EPOCH
  ) {
    epochCtx.currSyncCommitteeIndexes = epochCtx.nextSyncCommitteeIndexes;
    epochCtx.nextSyncCommitteeIndexes = getNextSyncCommitteeIndices(epochCtx.config, state);
    epochCtx.currSyncComitteeValidatorIndexMap = epochCtx.nextSyncComitteeValidatorIndexMap;
    epochCtx.nextSyncComitteeValidatorIndexMap = computeSyncComitteeMap(epochCtx.nextSyncCommitteeIndexes);
  }

  // If crossing through the altair fork the caches will be empty, fill them up
  if (currEpoch === epochCtx.config.params.ALTAIR_FORK_EPOCH) {
    const firstCommitteeIndices = getNextSyncCommitteeIndices(epochCtx.config, state);
    epochCtx.currSyncCommitteeIndexes = [...firstCommitteeIndices];
    epochCtx.nextSyncCommitteeIndexes = [...firstCommitteeIndices];
    epochCtx.currSyncComitteeValidatorIndexMap = computeSyncComitteeMap(epochCtx.currSyncCommitteeIndexes);
    epochCtx.nextSyncComitteeValidatorIndexMap = computeSyncComitteeMap(epochCtx.nextSyncCommitteeIndexes);
  }

  if (currEpoch >= epochCtx.config.params.ALTAIR_FORK_EPOCH) {
    epochCtx.syncParticipantReward = computeSyncParticipantReward(epochCtx.config, state);
    epochCtx.syncProposerReward =
      (epochCtx.syncParticipantReward * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);
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
  syncParticipantReward: Gwei;
  syncProposerReward: Gwei;
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
   * Update freq: every ~ 54h.
   * Memory cost: 1024 Number integers.
   */
  currSyncCommitteeIndexes: ValidatorIndex[];
  nextSyncCommitteeIndexes: ValidatorIndex[];
  /**
   * Update freq: every ~ 54h.
   * Memory cost: Map of Number -> Number with 1024 entries.
   */
  currSyncComitteeValidatorIndexMap: SyncComitteeValidatorIndexMap;
  nextSyncComitteeValidatorIndexMap: SyncComitteeValidatorIndexMap;
  syncParticipantReward: phase0.Gwei;
  syncProposerReward: phase0.Gwei;
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
    this.syncParticipantReward = data.syncParticipantReward;
    this.syncProposerReward = data.syncProposerReward;
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
    const epoch = computeEpochAtSlot(this.config, slot);
    if (epoch !== this.currentShuffling.epoch) {
      throw new Error(
        `Requesting beacon proposer for different epoch current shuffling: ${epoch} != ${this.currentShuffling.epoch}`
      );
    }
    return this.proposers[slot % this.config.params.SLOTS_PER_EPOCH];
  }

  /**
   * Return the indexed attestation corresponding to ``attestation``.
   */
  getIndexedAttestation(attestation: phase0.Attestation): phase0.IndexedAttestation {
    const {aggregationBits, data} = attestation;
    const committeeIndices = this.getBeaconCommittee(data.slot, data.index);
    let attestingIndices: phase0.ValidatorIndex[];
    if (isTreeBacked(attestation)) {
      attestingIndices = zipIndexesInBitList(
        committeeIndices,
        (attestation.aggregationBits as unknown) as TreeBacked<BitList>,
        this.config.types.phase0.CommitteeBits
      );
    } else {
      attestingIndices = [];
      for (const [i, index] of committeeIndices.entries()) {
        if (aggregationBits[i]) {
          attestingIndices.push(index);
        }
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
    const committeeIndices = this.getBeaconCommittee(data.slot, data.index);
    const validatorIndices = isTreeBacked(bits)
      ? zipIndexesInBitList(
          committeeIndices,
          (bits as unknown) as TreeBacked<BitList>,
          this.config.types.phase0.CommitteeBits
        )
      : committeeIndices.filter((_, index) => !!bits[index]);
    return validatorIndices;
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

    const epochStartSlot = computeStartSlotAtEpoch(this.config, epoch);
    for (let slot = epochStartSlot; slot < epochStartSlot + this.config.params.SLOTS_PER_EPOCH; slot++) {
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
    return isAggregatorFromCommitteeLength(this.config, committee.length, slotSignature);
  }

  addPubkey(index: ValidatorIndex, pubkey: Uint8Array): void {
    this.pubkey2index.set(pubkey, index);
    this.index2pubkey[index] = bls.PublicKey.fromBytes(pubkey, CoordType.jacobian); // Optimize for aggregation
  }

  private _getSlotCommittees(slot: Slot): ValidatorIndex[][] {
    const epoch = computeEpochAtSlot(this.config, slot);
    const epochSlot = slot % this.config.params.SLOTS_PER_EPOCH;
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
