import {ByteVector, hash, toHexString, readOnlyMap, BitList, List} from "@chainsafe/ssz";
import {PublicKey} from "@chainsafe/bls";
import {
  Attestation,
  AttestationData,
  BeaconState,
  BLSSignature,
  CommitteeIndex,
  Epoch,
  IndexedAttestation,
  Slot,
  ValidatorIndex,
  CommitteeAssignment,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {intToBytes, assert} from "@chainsafe/lodestar-utils";

import {DomainType, GENESIS_EPOCH} from "../../constants";
import {
  computeEpochAtSlot,
  computeProposerIndex,
  computeStartSlotAtEpoch,
  getAttestingIndicesFromCommittee,
  getSeed,
  isAggregatorFromCommitteeLength,
} from "../../util";
import {computeEpochShuffling, IEpochShuffling} from "./epochShuffling";
import {IEpochProcess} from "./epochProcess";

class PubkeyIndexMap extends Map<ByteVector, ValidatorIndex> {
  get(key: ByteVector): ValidatorIndex | undefined {
    return super.get((toHexString(key) as unknown) as ByteVector);
  }
  set(key: ByteVector, value: ValidatorIndex): this {
    return super.set((toHexString(key) as unknown) as ByteVector, value);
  }
}

export class EpochContext {
  // TODO: this is a hack, we need a safety mechanism in case a bad eth1 majority vote is in,
  // or handle non finalized data differently, or use an immutable.js structure for cheap copies
  // Warning: may contain pubkeys that do not yet exist in the current state, but do in a later processed state.
  public pubkey2index: PubkeyIndexMap;
  // Warning: may contain indices that do not yet exist in the current state, but do in a later processed state.
  public index2pubkey: PublicKey[];
  public proposers: number[];
  // Per spec definition, shuffling will always be defined. They are never called before loadState()
  public previousShuffling!: IEpochShuffling;
  public currentShuffling!: IEpochShuffling;
  public nextShuffling!: IEpochShuffling;
  public config: IBeaconConfig;
  public epochProcess?: IEpochProcess;

  constructor(config: IBeaconConfig) {
    this.config = config;
    this.pubkey2index = new PubkeyIndexMap();
    this.index2pubkey = [];
    this.proposers = [];
  }

  public loadState(state: BeaconState): void {
    this.syncPubkeys(state);
    const currentEpoch = computeEpochAtSlot(this.config, state.slot);
    const previousEpoch = currentEpoch === GENESIS_EPOCH ? GENESIS_EPOCH : currentEpoch - 1;
    const nextEpoch = currentEpoch + 1;

    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = readOnlyMap(state.validators, (v, i) => [
      i,
      v.activationEpoch,
      v.exitEpoch,
    ]);

    this.currentShuffling = computeEpochShuffling(this.config, state, indicesBounded, currentEpoch);
    if (previousEpoch === currentEpoch) {
      // in case of genesis
      this.previousShuffling = this.currentShuffling;
    } else {
      this.previousShuffling = computeEpochShuffling(this.config, state, indicesBounded, previousEpoch);
    }
    this.nextShuffling = computeEpochShuffling(this.config, state, indicesBounded, nextEpoch);
    this._resetProposers(state);
  }

  public copy(): EpochContext {
    const ctx = new EpochContext(this.config);
    // warning: pubkey cache is not copied, it is shared, as eth1 is not expected to reorder validators.
    ctx.pubkey2index = this.pubkey2index;
    ctx.index2pubkey = this.index2pubkey;
    // shallow copy the other data, it doesn't mutate (only completely replaced on rotation)
    ctx.proposers = this.proposers;
    ctx.previousShuffling = this.previousShuffling;
    ctx.currentShuffling = this.currentShuffling;
    ctx.nextShuffling = this.nextShuffling;
    ctx.epochProcess = this.epochProcess;
    return ctx;
  }

  public syncPubkeys(state: BeaconState): void {
    if (!this.pubkey2index) {
      this.pubkey2index = new PubkeyIndexMap();
    }
    if (!this.index2pubkey) {
      this.index2pubkey = [];
    }
    const currentCount = this.pubkey2index.size;
    if (currentCount !== this.index2pubkey.length) {
      throw new Error("Pubkey indices have fallen out of sync");
    }
    const newCount = state.validators.length;
    for (let i = currentCount; i < newCount; i++) {
      const pubkey = state.validators[i].pubkey.valueOf() as Uint8Array;
      this.pubkey2index.set(pubkey, i);
      this.index2pubkey.push(PublicKey.fromBytes(pubkey));
    }
  }

  public rotateEpochs(state: BeaconState): void {
    this.previousShuffling = this.currentShuffling;
    this.currentShuffling = this.nextShuffling;
    const nextEpoch = this.currentShuffling.epoch + 1;
    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = readOnlyMap(state.validators, (v, i) => [
      i,
      v.activationEpoch,
      v.exitEpoch,
    ]);
    this.nextShuffling = computeEpochShuffling(this.config, state, indicesBounded, nextEpoch);
    this._resetProposers(state);
  }

  public getBeaconCommittee(slot: Slot, index: CommitteeIndex): ValidatorIndex[] {
    const slotCommittees = this._getSlotCommittees(slot);
    if (index >= slotCommittees.length) {
      throw new Error(`crosslink committee retrieval: out of range committee index: ${index}`);
    }
    return slotCommittees[index];
  }

  public getCommitteeCountAtSlot(slot: Slot): number {
    return this._getSlotCommittees(slot).length;
  }

  public getBeaconProposer(slot: Slot): ValidatorIndex {
    const epoch = computeEpochAtSlot(this.config, slot);
    if (epoch !== this.currentShuffling.epoch) {
      throw new Error("beacon proposer index out of range");
    }
    return this.proposers[slot % this.config.params.SLOTS_PER_EPOCH];
  }

  public getIndexedAttestation(attestation: Attestation): IndexedAttestation {
    const data = attestation.data;
    const bits = readOnlyMap(attestation.aggregationBits, (b) => b);
    const committee = this.getBeaconCommittee(data.slot, data.index);
    // No need for a Set, the indices in the committee are already unique.
    const attestingIndices: ValidatorIndex[] = [];
    committee.forEach((index, i) => {
      if (bits[i]) {
        attestingIndices.push(index);
      }
    });
    // sort in-place
    attestingIndices.sort((a, b) => a - b);
    return {
      attestingIndices: attestingIndices as List<number>,
      data: data,
      signature: attestation.signature,
    };
  }

  public getAttestingIndices(data: AttestationData, bits: BitList): ValidatorIndex[] {
    const committee = this.getBeaconCommittee(data.slot, data.index);
    return getAttestingIndicesFromCommittee(committee, readOnlyMap(bits, (b) => b) as List<boolean>);
  }

  /**
   * Return the committee assignment in the ``epoch`` for ``validator_index``.
   * ``assignment`` returned is a tuple of the following form:
   * ``assignment[0]`` is the list of validators in the committee
   * ``assignment[1]`` is the index to which the committee is assigned
   * ``assignment[2]`` is the slot at which the committee is assigned
   * Return null if no assignment..
   */
  getCommitteeAssignment(epoch: Epoch, validatorIndex: ValidatorIndex): CommitteeAssignment | null {
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

  public isAggregator(slot: Slot, index: CommitteeIndex, slotSignature: BLSSignature): boolean {
    const committee = this.getBeaconCommittee(slot, index);
    return isAggregatorFromCommitteeLength(this.config, committee.length, slotSignature);
  }

  private _resetProposers(state: BeaconState): void {
    const epochSeed = getSeed(this.config, state, this.currentShuffling.epoch, DomainType.BEACON_PROPOSER);
    const startSlot = computeStartSlotAtEpoch(this.config, this.currentShuffling.epoch);
    this.proposers = [];
    for (let slot = startSlot; slot < startSlot + this.config.params.SLOTS_PER_EPOCH; slot++) {
      this.proposers.push(
        computeProposerIndex(
          this.config,
          state,
          this.currentShuffling.activeIndices,
          hash(Buffer.concat([epochSeed, intToBytes(slot, 8)]))
        )
      );
    }
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
