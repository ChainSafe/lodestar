import assert from "assert";
import {EventEmitter} from "events";
import {hashTreeRoot} from "@chainsafe/ssz";

import {BeaconBlock, BeaconState, Deposit, Eth1Data, number64} from "../types";
import {GENESIS_SLOT, SECONDS_PER_SLOT} from "../constants";

import {DB} from "../db";
import {Eth1Notifier} from "../eth1";
import logger from "../logger";

import {getEmptyBlock, getGenesisBeaconState} from "./genesis";

import {executeStateTransition} from "./stateTransition";
import {getBlockRoot, getEpochStartSlot} from "./stateTransition/util";

/**
 * The BeaconChain service deals with processing incoming blocks, advancing a state transition
 * and applying the fork choice rule to update the chain head
 */
export class BeaconChain extends EventEmitter {
  public chain: string;
  private db: DB;
  private eth1: Eth1Notifier;
  private _latestBlock: BeaconBlock;

  public constructor(opts, {db, eth1}) {
    super();
    this.chain = opts.chain;
    this.db = db;
    this.eth1 = eth1;
  }

  /**
   * Start beacon chain processing
   */
  public async start(): Promise<void> {
    try {
      const state = await this.db.getState();
    } catch (e) {
      // if state doesn't exist in the db, the chain maybe hasn't started
      // listen for eth1 Eth2Genesis event
      this.eth1.once('eth2genesis', this.initializeChain.bind(this));
    }
  }

  /**
   * Stop beacon chain processing
   */
  public async stop(): Promise<void> {}

  /**
   * Initialize the beacon chain with a genesis beacon state / block
   */
  public async initializeChain(genesisTime: number64, genesisDeposits: Deposit[], genesisEth1Data: Eth1Data): Promise<void> {
    logger.info('Initializing beacon chain.');
    const genesisState = getGenesisBeaconState(genesisDeposits, genesisTime, genesisEth1Data);
    const genesisBlock = getEmptyBlock();
    genesisBlock.stateRoot = hashTreeRoot(genesisState, BeaconState);
    await this.db.setBlock(genesisBlock);
    await this.db.setChainHead(genesisState, genesisBlock);
    await this.db.setJustifiedBlock(genesisBlock);
    await this.db.setFinalizedBlock(genesisBlock);
    await this.db.setJustifiedState(genesisState);
    await this.db.setFinalizedState(genesisState);
  }

  /**
   * Pre-process and run the per slot state transition function
   */
  public async receiveBlock(block: BeaconBlock): Promise<BeaconState> {
    let state = await this.db.getState();
    const isValidBlock = await this.isValidBlock(state, block);
    assert(isValidBlock);
    const headRoot = await this.db.getChainHeadRoot();

    // process skipped slots
    for (let i = state.slot; i < block.slot - 1; i++) {
      state = this.runStateTransition(null, state);
    }

    // process current slot
    state = this.runStateTransition(block, state);

    await this.db.setBlock(block);

    // forward processed block for additional processing
    this.emit('processedBlock', block);

    // TODO remove this hack, we're currently using this to advance the chain
    this._latestBlock = block;
    return state;
  }

  /**
   * Update the chain head using LMD GHOST
   */
  public async applyForkChoiceRule(): Promise<void> {
    const state = await this.db.getState();
    const currentJustifiedRoot = getBlockRoot(state, getEpochStartSlot(state.currentJustifiedEpoch));
    // const currentJustifiedRoot = state.currentJustifiedRoot;
    const currentJustifiedBlock = await this.db.getBlock(currentJustifiedRoot);
    const currentJustifiedState = await this.db.getJustifiedState();
    const currentRoot = await this.db.getChainHeadRoot();
    // TODO use lmd ghost to compute best block
    const block = this._latestBlock;
    if (!currentRoot.equals(hashTreeRoot(block, BeaconBlock))) {
      await this.db.setChainHead(state, block);
    }
  }

  /**
   * Ensure that the block is compliant with block processing validity conditions
   */
  public async isValidBlock(state: BeaconState, block: BeaconBlock): Promise<boolean> {
    // The parent block with root block.previous_block_root has been processed and accepted.
    const hasParent = await this.db.hasBlock(block.previousBlockRoot);
    if (!hasParent) {
      return false;
    }
    // An Ethereum 1.0 block pointed to by the state.latest_eth1_data.block_hash has been processed and accepted.
    // TODO: implement

    // The node's Unix time is greater than or equal to state.genesis_time + (block.slot - GENESIS_SLOT) * SECONDS_PER_SLOT.
    const stateSlotTime = state.genesisTime + ((block.slot - GENESIS_SLOT) * SECONDS_PER_SLOT);
    if (Math.floor(Date.now() / 1000) < stateSlotTime) {
      return false;
    }

    return true;
  }

  private runStateTransition(block: BeaconBlock | null, state: BeaconState): BeaconState {
    const newState = executeStateTransition(state, block);
    // TODO any extra processing, eg post epoch
    // TODO update ffg checkpoints (requires updated state object)
    return newState;
  }
}
