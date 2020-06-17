import {ByteVector, toHexString, hash, fromHexString} from "@chainsafe/ssz";
import {ValidatorIndex, Epoch, BeaconState, Slot, CommitteeIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {intToBytes} from "@chainsafe/lodestar-utils";

import {GENESIS_EPOCH, DomainType} from "../../constants";
import {computeEpochAtSlot, computeProposerIndex, computeStartSlotAtEpoch, getSeed} from "../../util";
import {IEpochShuffling, computeEpochShuffling} from "./epochShuffling";

class PubkeyIndexMap extends Map<ByteVector, ValidatorIndex> {
  get(key: ByteVector): ValidatorIndex | undefined {
    return super.get(toHexString(key) as unknown as ByteVector);
  }
  set(key: ByteVector, value: ValidatorIndex): this {
    return super.set(toHexString(key) as unknown as ByteVector, value);
  }
}

export class EpochContext {
  public pubkey2index: PubkeyIndexMap;
  public index2pubkey: Uint8Array[];
  public proposers: number[];
  public previousShuffling?: IEpochShuffling;
  public currentShuffling?: IEpochShuffling;
  public nextShuffling?: IEpochShuffling;
  public config: IBeaconConfig;

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

    // TODO use readonly iteration here
    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = Array.from(state.validators).map((v, i) => ([
      i, v.activationEpoch, v.exitEpoch,
    ]));

    this.currentShuffling = computeEpochShuffling(this.config, state, indicesBounded, currentEpoch);
    if (previousEpoch === currentEpoch) { // in case of genesis
      this.previousShuffling = this.currentShuffling;
    } else {
      this.previousShuffling = computeEpochShuffling(this.config, state, indicesBounded, previousEpoch);
    }
    this.nextShuffling = computeEpochShuffling(this.config, state, indicesBounded, nextEpoch);
    this._resetProposers(state);
  }

  public copy(): EpochContext {
    const ctx = new EpochContext(this.config);
    // full copy of pubkeys, this can mutate
    ctx.pubkey2index = new PubkeyIndexMap();
    for(const entry of this.pubkey2index.entries()) {
      ctx.pubkey2index.set(fromHexString(entry[0] as unknown as string), entry[1]);
    }
    ctx.index2pubkey = [...this.index2pubkey];
    // shallow copy the other data, it doesn't mutate (only completely replaced on rotation)
    ctx.proposers = this.proposers;
    ctx.previousShuffling = this.previousShuffling;
    ctx.currentShuffling = this.currentShuffling;
    ctx.nextShuffling = this.nextShuffling;
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
      this.index2pubkey.push(pubkey);
    }
  }

  public rotateEpochs(state: BeaconState): void {
    this.previousShuffling = this.currentShuffling;
    this.currentShuffling = this.nextShuffling;
    const nextEpoch = this.currentShuffling.epoch + 1;
    // TODO use readonly iteration here
    const indicesBounded: [ValidatorIndex, Epoch, Epoch][] = Array.from(state.validators).map((v, i) => ([
      i, v.activationEpoch, v.exitEpoch,
    ]));
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
          hash(Buffer.concat([epochSeed, intToBytes(slot, 8)])),
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
