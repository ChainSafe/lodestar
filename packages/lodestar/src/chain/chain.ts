/**
 * @module chain
 */

import assert from "assert";
import BN from "bn.js";
import {EventEmitter} from "events";
import {hashTreeRoot} from "@chainsafe/ssz";
import {Attestation, BeaconBlock, BeaconState, number64, uint16, uint64} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DEPOSIT_CONTRACT_TREE_DEPTH, GENESIS_SLOT} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {ILogger} from "../logger";
import {IBeaconMetrics} from "../metrics";

import {getEmptyBlock, initializeBeaconStateFromEth1, isValidGenesisState} from "./genesis/genesis";

import {stateTransition} from "./stateTransition";
import {LMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";
import {getAttestingIndices, computeEpochOfSlot, isActiveValidator} from "./stateTransition/util";
import {ChainEventEmitter, IBeaconChain} from "./interface";
import {ProgressiveMerkleTree} from "../util/merkleTree";
import {processSortedDeposits} from "../util/deposits";
import {IChainOptions} from "./options";
import {OpPool} from "../opPool";
import {Block} from "ethers/providers";

export interface IBeaconChainModules {
  config: IBeaconConfig;
  opPool: OpPool;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  logger: ILogger;
  metrics: IBeaconMetrics;
}

export class BeaconChain extends (EventEmitter as { new(): ChainEventEmitter }) implements IBeaconChain {

  public chain: string;
  public latestState: BeaconState = null;
  public forkChoice: LMDGHOST;
  public chainId: uint16;
  public networkId: uint64;

  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private logger: ILogger;
  private metrics: IBeaconMetrics;
  private opts: IChainOptions;
  
  public constructor(opts: IChainOptions, {config, db, eth1, opPool, logger, metrics}: IBeaconChainModules) {
    super();
    this.opts = opts;
    this.chain = opts.name;
    this.config = config;
    this.db = db;
    this.eth1 = eth1;
    this.opPool = opPool;
    this.logger = logger;
    this.metrics = metrics;
    this.forkChoice = new StatefulDagLMDGHOST();
    this.chainId = 0; // TODO make this real
    this.networkId = new BN(0); // TODO make this real

  }

  public async start(): Promise<void> {
    const state = await this.db.state.getLatest();
    // if state doesn't exist in the db, the chain maybe hasn't started
    if(!state) {
      // check every block if genesis
      this.logger.info("Chain not started, listening for genesis block");
      this.eth1.on('block', this.checkGenesis);
    }
    this.latestState = state;
    this.logger.info("Chain started, waiting blocks and attestations");
  }

  public async stop(): Promise<void> {
    this.eth1.removeListener('block', this.checkGenesis);
  }


  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const validators = getAttestingIndices(
      this.config, this.latestState, attestation.data, attestation.aggregationBits);
    const balances = validators.map((index) => this.latestState.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      this.forkChoice.addAttestation(attestation.data.beaconBlockRoot, validators[i], balances[i]);
    }
    this.emit('processedAttestation', attestation);
  }

  public async receiveBlock(block: BeaconBlock): Promise<void> {
    const isValidBlock = await this.isValidBlock(this.latestState, block);
    assert(isValidBlock);

    // process current slot
    await this.runStateTransition(block, this.latestState);
    await this.opPool.processBlockOperations(block);

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

  public async initializeBeaconChain(genesisState: BeaconState, merkleTree: ProgressiveMerkleTree): Promise<void> {
    this.logger.info(`Initializing beacon chain with genesisTime ${genesisState.genesisTime}`);
    const genesisBlock = getEmptyBlock();
    const stateRoot = hashTreeRoot(genesisState, this.config.types.BeaconState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = hashTreeRoot(genesisBlock, this.config.types.BeaconBlock);
    this.latestState = genesisState;
    await Promise.all([
      this.db.state.set(stateRoot, genesisState),
      this.db.block.set(blockRoot, genesisBlock),
      this.db.setChainHeadRoots(blockRoot, stateRoot, genesisBlock, genesisState),
      this.db.chain.setJustifiedBlockRoot(blockRoot),
      this.db.chain.setFinalizedBlockRoot(blockRoot),
      this.db.chain.setLatestStateRoot(stateRoot),
      this.db.chain.setJustifiedStateRoot(stateRoot),
      this.db.chain.setFinalizedStateRoot(stateRoot),
      this.db.merkleTree.set(genesisState.eth1DepositIndex, merkleTree.toObject())
    ]);
    this.forkChoice.addBlock(genesisBlock.slot, blockRoot, Buffer.alloc(32));
    this.forkChoice.setJustified(blockRoot);
    this.forkChoice.setFinalized(blockRoot);
    this.logger.info(`Beacon chain initialized`);
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
    const preFinalizedEpoch = state.finalizedCheckpoint.epoch;
    const preJustifiedEpoch = state.currentJustifiedCheckpoint.epoch;
    // Run the state transition
    let newState: BeaconState;
    const blockRoot = hashTreeRoot(block, this.config.types.BeaconBlock);
    try {
      newState = stateTransition(this.config, state, block, true);
    } catch (e) {
      // store block root in db and terminate
      await this.db.block.storeBadBlock(blockRoot);
      this.logger.warn(`Found bad block, block root: ${blockRoot} ` + e.message + '\n');
      return;
    }

    // On successful transition, update system state
    await Promise.all([
      this.db.block.set(blockRoot, block),
      this.db.state.set(block.stateRoot, newState),
    ]);
    this.forkChoice.addBlock(block.slot, blockRoot, block.parentRoot);
    this.updateDepositMerkleTree(newState);
    // update metrics
    this.metrics.currentSlot.set(block.slot);

    // Post-epoch processing
    const currentEpoch = computeEpochOfSlot(this.config, newState.slot);
    if (computeEpochOfSlot(this.config, preSlot) < currentEpoch) {
      // Update FFG Checkpoints
      // Newly justified epoch
      if (preJustifiedEpoch < newState.currentJustifiedCheckpoint.epoch) {
        const justifiedBlock = await this.db.block.get(newState.currentJustifiedCheckpoint.root);
        await Promise.all([
          this.db.chain.setJustifiedStateRoot(justifiedBlock.stateRoot),
          this.db.chain.setJustifiedBlockRoot(blockRoot),
        ]);
        this.forkChoice.setJustified(blockRoot);
      }
      // Newly finalized epoch
      if (preFinalizedEpoch < newState.finalizedCheckpoint.epoch) {
        const finalizedBlock = await this.db.block.get(newState.finalizedCheckpoint.root);
        await Promise.all([
          this.db.chain.setFinalizedStateRoot(finalizedBlock.stateRoot),
          this.db.chain.setFinalizedBlockRoot(blockRoot),
        ]);
        this.forkChoice.setFinalized(blockRoot);
      }
      this.metrics.previousJustifiedEpoch.set(newState.previousJustifiedCheckpoint.epoch);
      this.metrics.currentJustifiedEpoch.set(newState.currentJustifiedCheckpoint.epoch);
      this.metrics.currentFinalizedEpoch.set(newState.finalizedCheckpoint.epoch);
      this.metrics.currentEpochLiveValidators.set(newState.validators.filter((v) => isActiveValidator(v, currentEpoch)).length);
    }
    return newState;
  }

  private async updateDepositMerkleTree(newState: BeaconState): Promise<void> {
    let [deposits, merkleTree] = await Promise.all([
      this.db.deposit.getAll(),
      this.db.merkleTree.getProgressiveMerkleTree(
        newState.eth1DepositIndex - newState.eth1Data.depositCount
      )
    ]);
    processSortedDeposits(
      this.config,
      deposits,
      newState.eth1DepositIndex,
      newState.eth1Data.depositCount,
      (deposit, index) => {
        merkleTree.add(
          index + newState.eth1DepositIndex,
          hashTreeRoot(deposit.data, this.config.types.DepositData)
        );
        return deposit;
      }
    );
    //TODO: remove deposits with index <= newState.depositIndex
    await this.db.merkleTree.set(newState.eth1DepositIndex, merkleTree.toObject());
  }

  private checkGenesis = async (eth1Block: Block): Promise<void> => {
    this.logger.info(`Checking if block ${eth1Block.hash} will form valid genesis state`);
    const deposits = await this.opPool.deposits.getAll();
    const merkleTree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH);
    const depositsWithProof = deposits
      .map((deposit, index) => {
        merkleTree.add(index, hashTreeRoot(deposit.data, this.config.types.DepositData));
        return deposit;
      })
      .map((deposit, index) => {
        deposit.proof = merkleTree.getProof(index);
        return deposit;
      });
    const genesisState = initializeBeaconStateFromEth1 (
      this.config,
      Buffer.from(eth1Block.hash.replace("0x", ""), "hex"),
      eth1Block.timestamp,
      depositsWithProof
    );
    if(!isValidGenesisState(this.config, genesisState)) {
      this.logger.info(`Eth1 block ${eth1Block.hash} is NOT forming valid genesis state`);
      return;
    }
    this.logger.info(`Initializing beacon chain with eth1 block ${eth1Block.hash}`);
    await this.initializeBeaconChain(genesisState, merkleTree);
  };

  public isInitialized(): boolean {
    return !!this.latestState;
  }
}
