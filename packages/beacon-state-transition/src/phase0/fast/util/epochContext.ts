import {ByteVector, hash, toHexString, BitList, List, readonlyValues} from "@chainsafe/ssz";
import bls, {PublicKey} from "@chainsafe/bls";
import {BLSSignature, CommitteeIndex, Epoch, Slot, ValidatorIndex, phase0, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {intToBytes, assert} from "@chainsafe/lodestar-utils";

import {GENESIS_EPOCH} from "../../../constants";
import {
  computeEpochAtSlot,
  computeProposerIndex,
  computeStartSlotAtEpoch,
  getAttestingIndicesFromCommittee,
  getSeed,
  isAggregatorFromCommitteeLength,
} from "../../../util";
import {computeEpochShuffling, IEpochShuffling} from "./epochShuffling";
import {MutableVector} from "@chainsafe/persistent-ts";
import {CachedValidatorList} from "./cachedValidatorList";

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
  validators: MutableVector<phase0.Validator>
): EpochContext {
  const pubkey2index = new PubkeyIndexMap();
  const index2pubkey = [] as PublicKey[];
  syncPubkeys(state, pubkey2index, index2pubkey);
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
  return new EpochContext({
    config,
    pubkey2index,
    index2pubkey,
    proposers,
    previousShuffling,
    currentShuffling,
    nextShuffling,
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
    throw new Error("Pubkey indices have fallen out of sync");
  }
  const newCount = state.validators.length;
  for (let i = currentCount; i < newCount; i++) {
    const pubkey = state.validators[i].pubkey.valueOf() as Uint8Array;
    pubkey2index.set(pubkey, i);
    index2pubkey.push(bls.PublicKey.fromBytes(pubkey));
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
 * Called to re-use information, such as the shuffling of the next epoch, after transitioning into a
 * new epoch.
 */
export function rotateEpochs(
  epochCtx: EpochContext,
  state: phase0.BeaconState,
  validators: CachedValidatorList<phase0.Validator>
): void {
  epochCtx.previousShuffling = epochCtx.currentShuffling;
  epochCtx.currentShuffling = epochCtx.nextShuffling;
  const nextEpoch = epochCtx.currentShuffling.epoch + 1;
  const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = validators.map((v, i) => [
    i,
    v.activationEpoch,
    v.exitEpoch,
  ]);
  epochCtx.nextShuffling = computeEpochShuffling(epochCtx.config, state, indicesBounded, nextEpoch);
  epochCtx.proposers = computeProposers(epochCtx.config, state, epochCtx.currentShuffling);
}

interface IEpochContextParams {
  config: IBeaconConfig;
  pubkey2index: PubkeyIndexMap;
  index2pubkey: PublicKey[];
  proposers: number[];
  previousShuffling: IEpochShuffling;
  currentShuffling: IEpochShuffling;
  nextShuffling: IEpochShuffling;
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
  config: IBeaconConfig;

  constructor(params: IEpochContextParams) {
    this.config = params.config;
    this.pubkey2index = params.pubkey2index;
    this.index2pubkey = params.index2pubkey;
    this.proposers = params.proposers;
    this.previousShuffling = params.previousShuffling;
    this.currentShuffling = params.currentShuffling;
    this.nextShuffling = params.nextShuffling;
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
      throw new Error(`crosslink committee retrieval: out of range committee index: ${index}`);
    }
    return slotCommittees[index];
  }

  getCommitteeCountAtSlot(slot: Slot): number {
    return this._getSlotCommittees(slot).length;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    const epoch = computeEpochAtSlot(this.config, slot);
    if (epoch !== this.currentShuffling.epoch) {
      throw new Error("beacon proposer index out of range");
    }
    return this.proposers[slot % this.config.params.SLOTS_PER_EPOCH];
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
    const nextEpoch = this.currentShuffling.epoch + 1;
    assert.lte(epoch, nextEpoch, "Cannot get committee assignment for epoch more than 1 ahead");

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
    this.index2pubkey[index] = bls.PublicKey.fromBytes(pubkey);
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
      throw new Error(`crosslink committee retrieval: out of range epoch: ${epoch}`);
    }
  }
}
