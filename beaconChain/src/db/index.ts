import {EventEmitter} from "events";
import level from "level";
import { hashTreeRoot } from "@chainsafesystems/ssz";

import {
  BeaconState, bytes32, BeaconBlock, Slot, Attestation,
} from "../types";

import {
  Bucket,
  encodeKey,
  Key,
} from "./schema";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine, but instead expose relevent beacon chain objects
 */
export class DB extends EventEmitter {
  private db;

  public constructor(opts) {
    super();
    this.db = level('beaconchain')
  }
  public async start() {
    await this.db.open();
  }
  public async stop() {
    await this.db.close();
  }

  /**
   * Get the beacon chain state
   * @returns {Promise<BeaconState>}
   */
  public async getState(): Promise<BeaconState> {
    return await this.db.get(encodeKey(Bucket.chainInfo, Key.state));
  }

  /**
   * Set the beacon chain state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  public async setState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.state), state);
  }

  /**
   * Get the last finalized state
   * @returns {Promise<BeaconState>}
   */
  public async getFinalizedState(): Promise<BeaconState> {
    return await this.db.get(encodeKey(Bucket.chainInfo, Key.finalizedState));
  }

  /**
   * Set the last finalized state
   * @param {BeaconState} state
   * @returns {Promise<void>}
   */
  public async setFinalizedState(state: BeaconState): Promise<void> {
    await this.db.put(encodeKey(Bucket.chainInfo, Key.finalizedState), state);
  }

  /**
   * Get a block by block hash
   * @returns {Promise<BeaconBlock>}
   */
  public async getBlock(blockRoot: bytes32): Promise<BeaconBlock> {
    return await this.db.get(encodeKey(Bucket.block, blockRoot));
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
    const blockRoot = hashTreeRoot(block);
    await this.db.put(encodeKey(Bucket.block, blockRoot), block);
  }

  /**
   * Get the head of the chain
   * @returns {Promise<BeaconBlock>}
   */
  public async getChainHead(): Promise<BeaconBlock> {
    const height = await this.db.get(encodeKey(Bucket.chainInfo, Key.chainHeight));
    const blockRoot = await this.db.get(encodeKey(Bucket.mainChain, height));
    return await this.getBlock(blockRoot);
  }

  /**
   * Set the head of the chain
   * @param {BeaconState} state
   * @param {BeaconBlock} block
   * @returns {Promise<void>}
   */
  public async setChainHead(state: BeaconState, block: BeaconBlock): Promise<void> {
    const blockRoot = hashTreeRoot(block);
    const slot = block.slot.toNumber();
    // block should already be set
    await this.getBlock(blockRoot);
    await this.db.batch()
      .put(encodeKey(Bucket.mainChain, slot), blockRoot)
      .put(encodeKey(Bucket.chainInfo, Key.chainHeight), slot)
      .put(encodeKey(Bucket.chainInfo, Key.state), state)
      .write();
  }

  /**
   * Fetch an attestation by hash
   * @returns {Promise<Attestation>}
   */
  public async getAttestation(attestationRoot: bytes32): Promise<Attestation> {
    return await this.db.get(encodeKey(Bucket.attestation, attestationRoot));
  }

  /**
   * Put an attestation into the db
   * @param {Attestation} attestation
   * @returns {Promise<void>}
   */
  public async setAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = hashTreeRoot(attestation);
    await this.db.put(encodeKey(Bucket.attestation, attestationRoot), attestation);
  }

  /**
   * Delete an attestation from the db
   * @param {Attestation} attestation
   * @returns {Promise<void>}
   */
  public async deleteAttestation(attestation: Attestation): Promise<void> {
    const attestationRoot = hashTreeRoot(attestation);
    await this.db.del(encodeKey(Bucket.attestation, attestationRoot));
  }
}
