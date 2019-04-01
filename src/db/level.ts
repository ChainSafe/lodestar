import {EventEmitter} from "events";
import level from "level";
import {LevelUp} from "levelup";
import { serialize, deserialize, treeHash } from "@chainsafesystems/ssz";

import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  BeaconState,
  bytes32,
  ProposerSlashing,
  Slot,
  uint64,
  VoluntaryExit,
  Transfer,
} from "../types";

import {
  Bucket,
  encodeKey,
  Key,
} from "./schema";

import { DB, DBOptions } from "./interface";

export interface LevelDBOptions extends DBOptions {
  db?: LevelUp;
}

/**
 * The LevelDB implementation of DB
 */
export class LevelDB extends EventEmitter implements DB {
  private db: LevelUp;

  public constructor(opts: LevelDBOptions) {
    super();
    this.db = opts.db || level(opts.name || 'beaconchain');
  }
  public async start(): Promise<void> {
    await this.db.open();
  }
  public async stop(): Promise<void> {
    await this.db.close();
  }

  public async getState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.state));
    return deserialize(buf, BeaconState).deserializedData;
  }

  public async setState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.state), serialize(state, BeaconState));
  }

  public async getFinalizedState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.finalizedState));
    return deserialize(buf, BeaconState).deserializedData;
  }

  public async setJustifiedState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.justifiedState), serialize(state, BeaconState));
  }

  public async getJustifiedState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.justifiedState));
    return deserialize(buf, BeaconState).deserializedData;
  }

  public async setFinalizedState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.finalizedState), serialize(state, BeaconState));
  }

  public async getBlock(blockRoot: bytes32): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.block, blockRoot));
    return deserialize(buf, BeaconBlock).deserializedData;
  }

  public async hasBlock(blockHash: bytes32): Promise<boolean> {
    try {
      const block = this.getBlock(blockHash);
      return true;
    } catch (e) {
      return false;
    }
  }

  public async getBlockBySlot(slot: Slot): Promise<BeaconBlock> {
    const blockRoot = await this.db.get(encodeKey(Bucket.mainChain, slot.toNumber()));
    return await this.getBlock(blockRoot);
  }

  public async setBlock(block: BeaconBlock): Promise<void> {
    const blockRoot = treeHash(block, BeaconBlock);
    await this.db.put(encodeKey(Bucket.block, blockRoot), serialize(block, BeaconBlock));
  }

  public async getFinalizedBlock(): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.finalizedBlock));
    return deserialize(buf, BeaconBlock).deserializedData;
  }

  public async setFinalizedBlock(block: BeaconBlock): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.finalizedBlock), serialize(block, BeaconBlock));
  }

  public async getJustifiedBlock(): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.justifiedBlock));
    return deserialize(buf, BeaconBlock).deserializedData;
  }

  public async setJustifiedBlock(block: BeaconBlock): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.justifiedBlock), serialize(block, BeaconBlock));
  }

  public async getChainHead(): Promise<BeaconBlock> {
    const heightBuf = await this.db.get(encodeKey(Bucket.chainInfo, Key.chainHeight));
    const height = deserialize(heightBuf, uint64).deserializedData;
    const blockRoot = await this.db.get(encodeKey(Bucket.mainChain, height));
    return await this.getBlock(blockRoot);
  }

  public async getChainHeadRoot(): Promise<bytes32> {
    const block = await this.getChainHead();
    return treeHash(block, BeaconBlock);
  }

  public async setChainHead(state: BeaconState, block: BeaconBlock): Promise<void> {
    const blockRoot = treeHash(block, BeaconBlock);
    const slot = block.slot;
    // block should already be set
    await this.getBlock(blockRoot);
    await this.db.batch()
      .put(encodeKey(Bucket.mainChain, slot), blockRoot)
      .put(encodeKey(Bucket.chainInfo, Key.chainHeight), serialize(slot, uint64))
      .put(encodeKey(Bucket.chainInfo, Key.state), serialize(state, BeaconState))
      .write();
  }

  public async getAttestations(): Promise<Attestation[]> {
    return new Promise<Attestation[]>((resolve, reject) => {
      const attestations: Attestation[] = [];
      this.db.createValueStream({
        gt: encodeKey(Bucket.attestation, Buffer.alloc(0)),
        lt: encodeKey(Bucket.attestation + 1, Buffer.alloc(0)),
      }).on('data', function(data) {
        attestations.push(deserialize(data, Attestation).deserializedData);
      }).on('close', function() {
        resolve(attestations);
      }).on('end', function() {
        resolve(attestations);
      });
    });
  }

  public async setAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = treeHash(attestation, Attestation);
    await this.db.put(encodeKey(Bucket.attestation, attestationRoot), serialize(attestation, Attestation));
  }

  public async deleteAttestations(attestations: Attestation[]): Promise<void> {
    let batchOp = this.db.batch();
    attestations.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.attestation, treeHash(n, Attestation))))
    await batchOp.write();
  }

  public async getVoluntaryExits(): Promise<VoluntaryExit[]> {
    return new Promise<VoluntaryExit[]>((resolve, reject) => {
      const exits: VoluntaryExit[] = [];
      this.db.createValueStream({
        gt: encodeKey(Bucket.exit, Buffer.alloc(0)),
        lt: encodeKey(Bucket.exit + 1, Buffer.alloc(0)),
      }).on('data', function(data) {
        exits.push(deserialize(data, VoluntaryExit).deserializedData);
      }).on('close', function() {
        resolve(exits);
      }).on('end', function() {
        resolve(exits);
      });
    });
  }

  public async setVoluntaryExit(exit: VoluntaryExit): Promise<void> {
    const exitRoot = treeHash(exit, VoluntaryExit);
    await this.db.put(encodeKey(Bucket.exit, exitRoot), serialize(exit, VoluntaryExit));
  }

  public async deleteVoluntaryExits(exits: VoluntaryExit[]): Promise<void> {
    let batchOp = this.db.batch();
    exits.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.exit, treeHash(n, VoluntaryExit))))
    await batchOp.write();
  }

  public async getTransfers(): Promise<Transfer[]> {
    return new Promise<Transfer[]>((resolve, reject) => {
      const transfers: Transfer[] = [];
      this.db.createValueStream({
        gt: encodeKey(Bucket.transfer, Buffer.alloc(0)),
        lt: encodeKey(Bucket.transfer + 1, Buffer.alloc(0)),
      }).on('data', function(data) {
        transfers.push(deserialize(data, Transfer).deserializedData);
      }).on('close', function() {
        resolve(transfers);
      }).on('end', function() {
        resolve(transfers);
      });
    });
  }

  public async setTransfer(transfer: Transfer): Promise<void> {
    const transferRoot = treeHash(transfer, Transfer);
    await this.db.put(encodeKey(Bucket.transfer, transferRoot), serialize(transfer, Transfer));
  }

  public async deleteTransfers(transfers: Transfer[]): Promise<void> {
    let batchOp = this.db.batch();
    transfers.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.transfer, treeHash(n, Transfer))))
    await batchOp.write();
  }

  public async getProposerSlashings(): Promise<ProposerSlashing[]> {
    return new Promise<ProposerSlashing[]>((resolve, reject) => {
      const proposerSlashings: ProposerSlashing[] = [];
      this.db.createValueStream({
        gt: encodeKey(Bucket.proposerSlashing, Buffer.alloc(0)),
        lt: encodeKey(Bucket.proposerSlashing + 1, Buffer.alloc(0)),
      }).on('data', function(data) {
        proposerSlashings.push(deserialize(data, ProposerSlashing).deserializedData);
      }).on('close', function() {
        resolve(proposerSlashings);
      }).on('end', function() {
        resolve(proposerSlashings);
      });
    });
  }

  public async setProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void> {
    const proposerSlashingRoot = treeHash(proposerSlashing, ProposerSlashing);
    await this.db.put(encodeKey(Bucket.proposerSlashing, proposerSlashingRoot), serialize(proposerSlashing, ProposerSlashing));
  }

  public async deleteProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void> {
    let batchOp = this.db.batch();
    proposerSlashings.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.proposerSlashing, treeHash(n, ProposerSlashing))))
    await batchOp.write();
  }

  public async getAttesterSlashings(): Promise<AttesterSlashing[]> {
    return new Promise<AttesterSlashing[]>((resolve, reject) => {
      const attesterSlashings: AttesterSlashing[] = [];
      this.db.createValueStream({
        gt: encodeKey(Bucket.attesterSlashing, Buffer.alloc(0)),
        lt: encodeKey(Bucket.attesterSlashing + 1, Buffer.alloc(0)),
      }).on('data', function(data) {
        attesterSlashings.push(deserialize(data, AttesterSlashing).deserializedData);
      }).on('close', function() {
        resolve(attesterSlashings);
      }).on('end', function() {
        resolve(attesterSlashings);
      });
    });
  }

  public async setAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void> {
    const attesterSlashingRoot = treeHash(attesterSlashing, AttesterSlashing);
    await this.db.put(encodeKey(Bucket.attesterSlashing, attesterSlashingRoot), serialize(attesterSlashing, AttesterSlashing));
  }

  public async deleteAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void> {
    let batchOp = this.db.batch();
    attesterSlashings.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.attesterSlashing, treeHash(n, AttesterSlashing))))
    await batchOp.write();
  }
}
