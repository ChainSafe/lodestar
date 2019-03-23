import {EventEmitter} from "events";
import level from "level";
import {LevelUp} from "levelup";
import { serialize, deserialize, treeHash } from "@chainsafesystems/ssz";

import {
  BeaconState, bytes32, BeaconBlock, Slot, Attestation, uint64,
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
   * Fetch an attestation by hash
   * @returns {Promise<Attestation>}
   */
  public async getAttestation(attestationRoot: bytes32): Promise<Attestation> {
    const buf = await this.db.get(encodeKey(Bucket.attestation, attestationRoot));
    return deserialize(buf, Attestation).deserializedData;
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
   * Delete an attestation from the db
   * @param {Attestation} attestation
   * @returns {Promise<void>}
   */
  public async deleteAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = treeHash(attestation, Attestation);
    await this.db.del(encodeKey(Bucket.attestation, attestationRoot));
  }
}
