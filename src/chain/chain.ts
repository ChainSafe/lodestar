/**
 * @module chain
 */

import assert from "assert";
import BN from "bn.js";
import {EventEmitter} from "events";
import {hashTreeRoot} from "@chainsafe/ssz";

import {BeaconBlock, BeaconState, Deposit, Eth1Data, number64, Attestation, uint16, uint64} from "../types";
import {GENESIS_SLOT, SECONDS_PER_SLOT} from "../constants";

import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {ILogger} from "../logger";

import {getEmptyBlock, getGenesisBeaconState} from "./genesis";

import {executeStateTransition} from "./stateTransition";

import {LMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";
import {getAttestingIndices} from "./stateTransition/util";
import {IBeaconChain} from "./interface";

export class BeaconChain extends EventEmitter implements IBeaconChain {
  public chain: string;
  public genesisTime: number64;
  public forkChoice: LMDGHOST;
  public chainId: uint16;
  public networkId: uint64;
  private db: IBeaconDb;
  private eth1: IEth1Notifier;
  private _latestBlock: BeaconBlock;
  private logger: ILogger;

  public constructor(opts, {db, eth1, logger}: {db: IBeaconDb; eth1: IEth1Notifier; logger: ILogger}) {
    super();
    this.chain = opts.chain;
    this.db = db;
    this.eth1 = eth1;
    this.logger = logger;
    this.forkChoice = new StatefulDagLMDGHOST();
    this.chainId = 0; // TODO make this real
    this.networkId = new BN(0); // TODO make this real

  }

  public async start(): Promise<void> {
    try {
      //TODO unused var
      //const state = await this.db.getState();
      await this.db.getState();

    } catch (e) {
      // if state doesn't exist in the db, the chain maybe hasn't started
      // listen for eth1 Eth2Genesis event
      this.eth1.once('eth2genesis', this.initializeChain.bind(this));
    }
  }

  public async stop(): Promise<void> {}

  public async initializeChain(
    genesisTime: number64,
    genesisDeposits: Deposit[],
    genesisEth1Data: Eth1Data
  ): Promise<void> {
    this.logger.info('Initializing beacon chain.');
    const genesisState = getGenesisBeaconState(genesisDeposits, genesisTime, genesisEth1Data);
    const genesisBlock = getEmptyBlock();
    genesisBlock.stateRoot = hashTreeRoot(genesisState, BeaconState);
    this.genesisTime = genesisTime;
    await Promise.all([
      this.db.setBlock(genesisBlock),
      this.db.setChainHead(genesisState, genesisBlock),
      this.db.setJustifiedBlock(genesisBlock),
      this.db.setFinalizedBlock(genesisBlock),
      this.db.setJustifiedState(genesisState),
      this.db.setFinalizedState(genesisState),
    ]);
    const genesisRoot = hashTreeRoot(genesisBlock, BeaconBlock);
    this.forkChoice.addBlock(genesisBlock.slot, genesisRoot, Buffer.alloc(32));
    this.forkChoice.setJustified(genesisRoot);
    this.forkChoice.setFinalized(genesisRoot);
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const state = await this.db.getState();
    const validators = getAttestingIndices(
      state, attestation.data, attestation.aggregationBitfield);
    const balances = validators.map((index) => state.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      this.forkChoice.addAttestation(attestation.data.beaconBlockRoot, validators[i], balances[i]);
    }
    this.emit('processedAttestation', attestation);
  }

  public async receiveBlock(block: BeaconBlock): Promise<void> {
    let state = await this.db.getState();
    const isValidBlock = await this.isValidBlock(state, block);
    assert(isValidBlock);

    // process current slot
    state = this.runStateTransition(block, state);

    await this.db.setBlock(block);

    this.forkChoice.addBlock(block.slot, hashTreeRoot(block, BeaconBlock), block.previousBlockRoot);

    // forward processed block for additional processing
    this.emit('processedBlock', block);
  }

  public async applyForkChoiceRule(): Promise<void> {
    const [state, currentRoot] = await Promise.all([
      this.db.getState(),
      this.db.getChainHeadRoot(),
    ]);
    const headRoot = this.forkChoice.head();
    if (!currentRoot.equals(headRoot)) {
      const block = await this.db.getBlock(headRoot);
      await this.db.setChainHead(state, block);
    }
  }

  public async isValidBlock(state: BeaconState, block: BeaconBlock): Promise<boolean> {
    // The parent block with root block.previous_block_root has been processed and accepted.
    const hasParent = await this.db.hasBlock(block.previousBlockRoot);
    if (!hasParent) {
      return false;
    }
    // An Ethereum 1.0 block pointed to by the state.
    // latest_eth1_data.block_hash has been processed and accepted.
    // TODO: implement

    // The node's Unix time is greater than or equal to state.
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
