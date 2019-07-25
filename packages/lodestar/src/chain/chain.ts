/**
 * @module chain
 */

import assert from "assert";
import BN from "bn.js";
import {EventEmitter} from "events";
import {hashTreeRoot} from "@chainsafe/ssz";
import {Attestation, BeaconBlock, BeaconState, Deposit, Eth1Data, number64, uint16, uint64} from "../types";
import {DEPOSIT_CONTRACT_TREE_DEPTH, GENESIS_SLOT} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {ILogger} from "../logger";
import {IBeaconConfig} from "../config";
import {getEmptyBlock, getGenesisBeaconState} from "./genesis";
import {stateTransition} from "./stateTransition";
import {LMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";
import {getAttestingIndices, slotToEpoch} from "./stateTransition/util";
import {IBeaconChain} from "./interface";
import {ProgressiveMerkleTree} from "../util/merkleTree";
import {processSortedDeposits} from "../util/deposits";

export class BeaconChain extends EventEmitter implements IBeaconChain {
  public chain: string;
  public genesisTime: number64;
  public forkChoice: LMDGHOST;
  public chainId: uint16;
  public networkId: uint64;
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private eth1: IEth1Notifier;
  private _latestBlock: BeaconBlock;
  private logger: ILogger;

  public constructor(opts, {config, db, eth1, logger}: { config: IBeaconConfig; db: IBeaconDb; eth1: IEth1Notifier; logger: ILogger }) {
    super();
    this.chain = opts.chain;
    this.config = config;
    this.db = db;
    this.eth1 = eth1;
    this.logger = logger;
    this.forkChoice = new StatefulDagLMDGHOST();
    this.chainId = 0; // TODO make this real
    this.networkId = new BN(0); // TODO make this real

  }

  public async start(): Promise<void> {
    // if state doesn't exist in the db, the chain maybe hasn't started
    if (!await this.db.state.getLatest()) {
      // listen for eth1 Eth2Genesis event
      this.eth1.once('eth2genesis', this.initializeChain.bind(this));
    }
  }

  public async stop(): Promise<void> {
  }

  public async initializeChain(
    genesisTime: number64,
    genesisDeposits: Deposit[],
    genesisEth1Data: Eth1Data
  ): Promise<void> {
    this.logger.info('Initializing beacon chain.');
    const merkleTree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH);
    genesisDeposits = genesisDeposits
      .map((deposit, index) => {
        merkleTree.add(index, hashTreeRoot(deposit.data, this.config.types.DepositData));
        return deposit;
      })
      .map((deposit, index) => {
        deposit.proof = merkleTree.getProof(index);
        return deposit;
      });
    const genesisState = getGenesisBeaconState(
      this.config,
      genesisDeposits,
      genesisTime,
      genesisEth1Data
    );
    const genesisBlock = getEmptyBlock();
    const stateRoot = hashTreeRoot(genesisState, this.config.types.BeaconState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = hashTreeRoot(genesisBlock, this.config.types.BeaconBlock);
    this.genesisTime = genesisTime;
    await Promise.all([
      this.db.state.store(stateRoot, genesisState),
      this.db.block.store(blockRoot, genesisBlock),
      this.db.setChainHeadRoots(blockRoot, stateRoot, genesisBlock, genesisState),
      this.db.chain.setJustifiedBlockRoot(blockRoot),
      this.db.chain.setFinalizedBlockRoot(blockRoot),
      this.db.chain.setLatestStateRoot(stateRoot),
      this.db.chain.setJustifiedStateRoot(stateRoot),
      this.db.chain.setFinalizedStateRoot(stateRoot),
      this.db.merkleTree.store(genesisState.depositIndex, merkleTree.toObject())
    ]);
    this.forkChoice.addBlock(genesisBlock.slot, blockRoot, Buffer.alloc(32));
    this.forkChoice.setJustified(blockRoot);
    this.forkChoice.setFinalized(blockRoot);
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const state = await this.db.state.getLatest();
    const validators = getAttestingIndices(
      this.config, state, attestation.data, attestation.aggregationBitfield);
    const balances = validators.map((index) => state.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      this.forkChoice.addAttestation(attestation.data.beaconBlockRoot, validators[i], balances[i]);
    }
    this.emit('processedAttestation', attestation);
  }

  public async receiveBlock(block: BeaconBlock): Promise<void> {
    const state = await this.db.state.getLatest();
    const isValidBlock = await this.isValidBlock(state, block);
    assert(isValidBlock);

    // process current slot
    await this.runStateTransition(block, state);

    // forward processed block for additional processing
    this.emit('processedBlock', block);
  }

  public async applyForkChoiceRule(): Promise<void> {
    const currentRoot = await this.db.chain.getChainHeadRoot();
    const headRoot = this.forkChoice.head();
    if (!currentRoot.equals(headRoot)) {
      const block = await this.db.block.get(headRoot);
      await this.db.setChainHeadRoots(currentRoot, block.stateRoot, block);
    }
  }

  public async isValidBlock(state: BeaconState, block: BeaconBlock): Promise<boolean> {
    // The parent block with root block.previous_block_root has been processed and accepted.
    const hasParent = await this.db.block.has(block.parentRoot);
    if (!hasParent) {
      return false;
    }
    // An Ethereum 1.0 block pointed to by the state.
    // latest_eth1_data.block_hash has been processed and accepted.
    // TODO: implement

    // The node's Unix time is greater than or equal to state.
    const stateSlotTime = state.genesisTime + ((block.slot - GENESIS_SLOT) * this.config.params.SECONDS_PER_SLOT);
    return Math.floor(Date.now() / 1000) >= stateSlotTime;
  }

  private async runStateTransition(block: BeaconBlock, state: BeaconState): Promise<BeaconState> {
    const preSlot = state.slot;
    const preFinalizedEpoch = state.finalizedEpoch;
    const preJustifiedEpoch = state.currentJustifiedEpoch;
    // Run the state transition
    let newState: BeaconState;
    try {
      newState = stateTransition(this.config, state, block, true);
    } catch (e) {
      // store block root in db and terminate
      const blockRoot = hashTreeRoot(block, this.config.types.BeaconBlock);
      await this.db.block.storeBadBlock(blockRoot);
      this.logger.warn(`Found bad block, block root: ${blockRoot} ` + e.message + '\n');
      return;
    }

    // On successful transition, update system state
    const blockRoot = hashTreeRoot(block, this.config.types.BeaconBlock);
    await Promise.all([
      this.db.block.store(blockRoot, block),
      this.db.state.store(block.stateRoot, newState),
    ]);
    this.forkChoice.addBlock(block.slot, blockRoot, block.parentRoot);
    this.updateDepositMerkleTree(newState);

    // Post-epoch processing
    if (slotToEpoch(this.config, preSlot) < slotToEpoch(this.config, newState.slot)) {
      // Update FFG Checkpoints
      // Newly justified epoch
      if (preJustifiedEpoch < newState.currentJustifiedEpoch) {
        const justifiedBlock = await this.db.block.get(newState.currentJustifiedRoot);
        await Promise.all([
          this.db.chain.setJustifiedBlockRoot(blockRoot),
          this.db.chain.setJustifiedStateRoot(justifiedBlock.stateRoot)
        ]);
        this.forkChoice.setJustified(blockRoot);
      }
      // Newly finalized epoch
      if (preFinalizedEpoch < newState.finalizedEpoch) {
        const finalizedBlock = await this.db.block.get(newState.finalizedRoot);
        await Promise.all([
          this.db.chain.setFinalizedBlockRoot(blockRoot),
          this.db.chain.setFinalizedStateRoot(finalizedBlock.stateRoot)
        ]);
        this.forkChoice.setFinalized(blockRoot);
      }
    }
    return newState;
  }

  private async updateDepositMerkleTree(newState: BeaconState): Promise<void> {
    let [deposits, merkleTree] = await Promise.all([
      this.db.deposit.getAll(),
      this.db.merkleTree.get(newState.depositIndex - newState.latestEth1Data.depositCount)
        .then((tree) => new ProgressiveMerkleTree(tree.depth, tree.tree))
    ]);
    processSortedDeposits(
      this.config,
      deposits,
      newState.depositIndex,
      newState.latestEth1Data.depositCount,
      (deposit, index) => {
        merkleTree.add(
          index + newState.depositIndex,
          hashTreeRoot(deposit.data, this.config.types.DepositData)
        );
        return deposit;
      }
    );
    //TODO: remove deposits with index <= newState.depositIndex
    await this.db.merkleTree.store(newState.depositIndex, merkleTree.toObject());
  }
}
