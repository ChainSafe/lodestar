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

export interface DBOptions {
  name?: string;
  db?: LevelUp;
}

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine, but instead expose relevent beacon chain objects
 */
export class DB extends EventEmitter {
  private db: LevelUp;

  public constructor(opts: DBOptions) {
    super();
    this.db = opts.db || level(opts.name || 'beaconchain');
  }
  public async start(): Promise<void> {
    await this.db.open();
  }
  public async stop(): Promise<void> {
    await this.db.close();
  }

  /**
   * Get the beacon chain state
   * @returns {Promise<BeaconState>}
   */
  public async getState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.state));
    return deserialize(buf, BeaconState).deserializedData;
  }

  /**
   * Set the beacon chain state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  public async setState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.state), serialize(state, BeaconState));
  }

  /**
   * Get the last finalized state
   * @returns {Promise<BeaconState>}
   */
  public async getFinalizedState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.finalizedState));
    return deserialize(buf, BeaconState).deserializedData;
  }

  /**
   * Set the last justified state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  public async setJustifiedState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.justifiedState), serialize(state, BeaconState));
  }

  /**
   * Get the last justified state
   * @returns {Promise<BeaconState>}
   */
  public async getJustifiedState(): Promise<BeaconState> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.justifiedState));
    return deserialize(buf, BeaconState).deserializedData;
  }

  /**
   * Set the last finalized state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  public async setFinalizedState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.finalizedState), serialize(state, BeaconState));
  }

  /**
   * Get a block by block hash
   * @returns {Promise<BeaconBlock>}
   */
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

  /**
   * Get a block by slot
   * @returns {Promise<BeaconBlock>}
   */
  public async getBlockBySlot(slot: Slot): Promise<BeaconBlock> {
    const blockRoot = await this.db.get(encodeKey(Bucket.mainChain, slot.toNumber()));
    return await this.getBlock(blockRoot);
  }

  /**
   * Put a block into the db
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  public async setBlock(block: BeaconBlock): Promise<void> {
    const blockRoot = treeHash(block, BeaconBlock);
    await this.db.put(encodeKey(Bucket.block, blockRoot), serialize(block, BeaconBlock));
  }

  /**
   * Get the latest finalized block
   * @returns {Promise<BeaconBlock>}
   */
  public async getFinalizedBlock(): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.finalizedBlock));
    return deserialize(buf, BeaconBlock).deserializedData;
  }

  /**
   * Set the latest finalized block
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  public async setFinalizedBlock(block: BeaconBlock): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.finalizedBlock), serialize(block, BeaconBlock));
  }

  /**
   * Get the latest justified block
   * @returns {Promise<BeaconBlock>}
   */
  public async getJustifiedBlock(): Promise<BeaconBlock> {
    const buf = await this.db.get(encodeKey(Bucket.chainInfo, Key.justifiedBlock));
    return deserialize(buf, BeaconBlock).deserializedData;
  }

  /**
   * Set the latest justified block
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  public async setJustifiedBlock(block: BeaconBlock): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.justifiedBlock), serialize(block, BeaconBlock));
  }

  /**
   * Get the head of the chain
   * @returns {Promise<BeaconBlock>}
   */
  public async getChainHead(): Promise<BeaconBlock> {
    const heightBuf = await this.db.get(encodeKey(Bucket.chainInfo, Key.chainHeight));
    const height = deserialize(heightBuf, uint64).deserializedData;
    const blockRoot = await this.db.get(encodeKey(Bucket.mainChain, height));
    return await this.getBlock(blockRoot);
  }

  /**
   * Get the root of the head of the chain
   * @returns {Promise<bytes32>}
   */
  public async getChainHeadRoot(): Promise<bytes32> {
    const block = await this.getChainHead();
    return treeHash(block, BeaconBlock);
  }

  /**
   * Set the head of the chain
   * @param {BeaconState} state
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
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

  /**
   * Fetch all attestations
   * @returns {Promise<Attestation[]>}
   */
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

  /**
   * Put an attestation into the db
   * @param {Attestation} attestation
   * @returns {Promise<void>}
   */
  public async setAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = treeHash(attestation, Attestation);
    await this.db.put(encodeKey(Bucket.attestation, attestationRoot), serialize(attestation, Attestation));
  }

  /**
   * Delete attestations from the db
   * @param {Attestation[]} attestations
   * @returns {Promise<void>}
   */
  public async deleteAttestations(attestations: Attestation[]): Promise<void> {
    let batchOp = this.db.batch();
    attestations.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.attestation, treeHash(n, Attestation))))
    await batchOp.write();
  }

  /**
   * Fetch all voluntary exits
   * @returns {Promise<VoluntaryExit[]>}
   */
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

  /**
   * Put a voluntary exit into the db
   * @param {VoluntaryExit} exit
   * @returns {Promise<void>}
   */
  public async setVoluntaryExit(exit: VoluntaryExit): Promise<void> {
    const exitRoot = treeHash(exit, VoluntaryExit);
    await this.db.put(encodeKey(Bucket.exit, exitRoot), serialize(exit, VoluntaryExit));
  }

  /**
   * Delete voluntary exits from the db
   * @param {VoluntaryExit[]} exits
   * @returns {Promise<void>}
   */
  public async deleteVoluntaryExits(exits: VoluntaryExit[]): Promise<void> {
    let batchOp = this.db.batch();
    exits.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.exit, treeHash(n, VoluntaryExit))))
    await batchOp.write();
  }

  /**
   * Fetch all transfers
   * @returns {Promise<Transfer[]>}
   */
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

  /**
   * Put a transfer into the db
   * @param {Transfer} transfer
   * @returns {Promise<void>}
   */
  public async setTransfer(transfer: Transfer): Promise<void> {
    const transferRoot = treeHash(transfer, Transfer);
    await this.db.put(encodeKey(Bucket.transfer, transferRoot), serialize(transfer, Transfer));
  }

  /**
   * Delete transfers from the db
   * @param {Transfer[]} transfers
   * @returns {Promise<void>}
   */
  public async deleteTransfers(transfers: Transfer[]): Promise<void> {
    let batchOp = this.db.batch();
    transfers.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.transfer, treeHash(n, Transfer))))
    await batchOp.write();
  }

  /**
   * Fetch all proposer slashings
   * @returns {Promise<ProposerSlashing[]>}
   */
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

  /**
   * Put a proposer slashing into the db
   * @param {ProposerSlashing} proposerSlashing
   * @returns {Promise<void>}
   */
  public async setProposerSlashing(proposerSlashing: ProposerSlashing): Promise<void> {
    const proposerSlashingRoot = treeHash(proposerSlashing, ProposerSlashing);
    await this.db.put(encodeKey(Bucket.proposerSlashing, proposerSlashingRoot), serialize(proposerSlashing, ProposerSlashing));
  }

  /**
   * Delete attestations from the db
   * @param {Attestation[]} attestations
   * @returns {Promise<void>}
   */
  public async deleteProposerSlashings(proposerSlashings: ProposerSlashing[]): Promise<void> {
    let batchOp = this.db.batch();
    proposerSlashings.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.proposerSlashing, treeHash(n, ProposerSlashing))))
    await batchOp.write();
  }

  /**
   * Fetch all attester slashings
   * @returns {Promise<AttesterSlashing[]>}
   */
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

  /**
   * Put an attester slashing into the db
   * @param {AttesterSlashing} attesterSlashing
   * @returns {Promise<void>}
   */
  public async setAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<void> {
    const attesterSlashingRoot = treeHash(attesterSlashing, AttesterSlashing);
    await this.db.put(encodeKey(Bucket.attesterSlashing, attesterSlashingRoot), serialize(attesterSlashing, AttesterSlashing));
  }

  /**
   * Delete attester slashings from the db
   * @param {AttesterSlashing[]} attesterSlashings
   * @returns {Promise<void>}
   */
  public async deleteAttesterSlashings(attesterSlashings: AttesterSlashing[]): Promise<void> {
    let batchOp = this.db.batch();
    attesterSlashings.forEach((n) =>
      batchOp = batchOp.del(encodeKey(Bucket.attesterSlashing, treeHash(n, AttesterSlashing))))
    await batchOp.write();
  }
}
