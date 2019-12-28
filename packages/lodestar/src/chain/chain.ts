/**
 * @module chain
 */

import assert from "assert";
import {EventEmitter} from "events";
import {clone, hashTreeRoot, serialize, signingRoot} from "@chainsafe/ssz";
import {Attestation, BeaconBlock, BeaconState, Hash, Slot, uint16, uint64, bool} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DEPOSIT_CONTRACT_TREE_DEPTH, GENESIS_SLOT} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {ILogger} from "../logger";
import {IBeaconMetrics} from "../metrics";

import {getEmptyBlock, initializeBeaconStateFromEth1, isValidGenesisState} from "./genesis/genesis";

import {
  processSlots, stateTransition,
  computeEpochOfSlot,
  getAttestationDataSlot,
  getAttestingIndices,
  isActiveValidator
  , getCurrentSlot
} from "@chainsafe/eth2.0-state-transition";
import {ILMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";

import {ChainEventEmitter, IBeaconChain} from "./interface";
import {processSortedDeposits} from "../util/deposits";
import {IChainOptions} from "./options";
import {OpPool} from "../opPool";
import {Block} from "ethers/providers";
import fs from "fs";
import {sleep} from "../util/sleep";
import {AsyncQueue, queue} from "async";
import FastPriorityQueue from "fastpriorityqueue";

import {ProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";
import {MerkleTreeSerialization} from "../util/serialization";

export interface IBeaconChainModules {
  config: IBeaconConfig;
  opPool: OpPool;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  logger: ILogger;
  metrics: IBeaconMetrics;
}

export interface IBlockProcessJob {
  block: BeaconBlock;
  trusted: boolean;
}

export class BeaconChain extends (EventEmitter as { new(): ChainEventEmitter }) implements IBeaconChain {

  public chain: string;
  public _latestState: BeaconState = null;
  public forkChoice: ILMDGHOST;
  public chainId: uint16;
  public networkId: uint64;

  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private logger: ILogger;
  private metrics: IBeaconMetrics;
  private opts: IChainOptions;
  private attestationProcessingQueue: AsyncQueue<Function>;
  private blockProcessingQueue: FastPriorityQueue<IBlockProcessJob>; //sort by slot number

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
    this.networkId = 0n; // TODO make this real
    this.attestationProcessingQueue = queue(async (task: Function) => {
      await task();
    }, 1);
    this.blockProcessingQueue = new FastPriorityQueue((a: IBlockProcessJob, b: IBlockProcessJob) => {
      return a.block.slot < b.block.slot;
    });
  }

  public async start(): Promise<void> {
    const state = this.latestState || await this.db.state.getLatest();
    // if state doesn't exist in the db, the chain maybe hasn't started
    if (!state) {
      // check every block if genesis
      this.logger.info("Chain not started, listening for genesis block");
      this.eth1.on("block", this.checkGenesis);
    }
    this.latestState = state;
    this.logger.info("Chain started, waiting blocks and attestations");
  }

  public async stop(): Promise<void> {
    this.eth1.removeListener("block", this.checkGenesis);
  }

  public get latestState(): BeaconState {
    return clone(this.config.types.BeaconState, this._latestState);
  }

  public set latestState(state: BeaconState) {
    this._latestState = state;
  }

  public isInitialized(): boolean {
    return !!this.latestState;
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    const attestationHash = hashTreeRoot(this.config.types.Attestation, attestation);
    this.logger.info(`Received attestation ${attestationHash.toString("hex")}`);
    const latestState = this.latestState;
    try {
      const attestationSlot: Slot = getAttestationDataSlot(this.config, latestState, attestation.data);
      if (attestationSlot + this.config.params.SLOTS_PER_EPOCH < latestState.slot) {
        this.logger.verbose(`Attestation ${attestationHash.toString("hex")} is too old. Ignored.`);
        return;
      }
    } catch (e) {
      return;
    }
    this.attestationProcessingQueue.push(async () => {
      return this.processAttestation(latestState, attestation, attestationHash);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async receiveBlock(block: BeaconBlock, trusted = false): Promise<void> {
    const blockHash = signingRoot(this.config.types.BeaconBlock, block);
    this.logger.info(
      `Received block with hash 0x${blockHash.toString("hex")}` +
      `at slot ${block.slot}. Current state slot ${this.latestState.slot}`
    );

    if (!await this.db.block.has(block.parentRoot)) {
      this.emit("unknownBlockRoot", block.parentRoot);
    }

    if (block.slot <= this.latestState.slot) {
      this.logger.warn(
        `Block ${blockHash.toString("hex")} is in past. ` +
        "Probably fork choice/double propose/processed block. Ignored for now."
      );
      return;
    }

    if (block.slot > this.latestState.slot) {
      //either block came too early or we are suppose to skip some slots
      const latestBlock = await this.db.block.getChainHead();
      if (!block.parentRoot.equals(signingRoot(this.config.types.BeaconBlock, latestBlock))) {
        //block processed too early
        this.logger.warn(`Block ${blockHash.toString("hex")} tried to be processed too early. Requeue...`);
        //wait a bit to give new block a chance
        await sleep(500);
        // add to priority queue
        this.blockProcessingQueue.add({block, trusted});
        return;
      }
    }

    await this.processBlock({block, trusted: false}, blockHash);
    const nextBlockInQueue = this.blockProcessingQueue.peek();
    while (nextBlockInQueue) {
      const latestBlock = await this.db.block.getChainHead();
      if (nextBlockInQueue.block.parentRoot.equals(signingRoot(this.config.types.BeaconBlock, latestBlock))) {
        await this.processBlock(nextBlockInQueue, signingRoot(this.config.types.BeaconBlock, nextBlockInQueue));
        this.blockProcessingQueue.poll();
      } else {
        return;
      }
    }
  }

  public async advanceState(slot?: Slot): Promise<void> {
    const targetSlot = slot || getCurrentSlot(this.config, this.latestState.genesisTime);
    this.logger.info(`Manually advancing slot from state slot ${this.latestState.slot} to ${targetSlot} `);
    const state = this.latestState;

    try {
      processSlots(this.config, state, targetSlot);
    } catch (e) {
      this.logger.warn(`Failed to advance slot mannually because ${e.message}`);
    }
    this.latestState = state;
    await this.db.state.add(state);
    await this.db.chain.setLatestStateRoot(hashTreeRoot(this.config.types.BeaconState, state));
  }

  public async applyForkChoiceRule(): Promise<void> {
    const currentRoot = await this.db.chain.getChainHeadRoot();
    const headRoot = this.forkChoice.head();
    if (currentRoot && !currentRoot.equals(headRoot)) {
      const block = await this.db.block.get(headRoot);
      await this.db.updateChainHead(headRoot, block.stateRoot);
      this.logger.info(`Fork choice changed head to 0x${headRoot.toString("hex")}`);
    }
  }

  public async initializeBeaconChain(genesisState: BeaconState, merkleTree: ProgressiveMerkleTree): Promise<void> {
    this.logger.info(`Initializing beacon chain with genesisTime ${genesisState.genesisTime}`);
    const genesisBlock = getEmptyBlock();
    const stateRoot = hashTreeRoot(this.config.types.BeaconState, genesisState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = signingRoot(this.config.types.BeaconBlock, genesisBlock);
    this.latestState = genesisState;
    // Determine whether a genesis state already in
    // the database matches what we were provided
    const storedGenesisBlock = await this.db.block.getBlockBySlot(GENESIS_SLOT);
    if (storedGenesisBlock !== null) {
      const storedGenesisState = await this.db.state.get(storedGenesisBlock.stateRoot);
      if (storedGenesisState !== null && !this.areEqualStates(genesisState, storedGenesisState)) {
        throw new Error("A genesis state with different configuration was detected! Please clean the database.");
      }
    }
    await Promise.all([
      this.db.storeChainHead(genesisBlock, genesisState),
      this.db.chain.setJustifiedBlockRoot(blockRoot),
      this.db.chain.setFinalizedBlockRoot(blockRoot),
      this.db.chain.setJustifiedStateRoot(stateRoot),
      this.db.chain.setFinalizedStateRoot(stateRoot),
      this.db.merkleTree.set(genesisState.eth1DepositIndex, merkleTree.toObject())
    ]);
    this.forkChoice.addBlock(genesisBlock.slot, blockRoot, Buffer.alloc(32));
    this.forkChoice.setJustified(blockRoot);
    this.forkChoice.setFinalized(blockRoot);
    this.logger.info("Beacon chain initialized");
  }

  // By declaring the states as records, we can check their equality
  // without making any assumptions of what keys exist
  private areEqualStates(first: Record<string, any> | null, second: Record<string, any> | null): boolean {
    if (first === null && second === null) {
      return true;
    }
    return Object.keys(first).every(key => {
      const valueIsArray = first[key] instanceof Array;
      if (valueIsArray) {
        const firstArray = first[key];
        const secondArray = second[key];
        // This logic assumes that there 
        // are no duplicates in the arrays
        return firstArray.length === secondArray.length &&
          firstArray.every((elem: any) => secondArray.includes(elem));
      }
      return first[key] === second[key];
    });
  }

  public async isValidBlock(state: BeaconState, block: BeaconBlock): Promise<boolean> {
    // The parent block with root block.previous_block_root has been processed and accepted.
    // const hasParent = await this.db.block.has(block.parentRoot);
    // if (!hasParent) {
    //   return false;
    // }
    // An Ethereum 1.0 block pointed to by the state.
    // latest_eth1_data.block_hash has been processed and accepted.
    // TODO: implement

    // The node's Unix time is greater than or equal to state.
    const stateSlotTime = state.genesisTime + ((block.slot - GENESIS_SLOT) * this.config.params.SECONDS_PER_SLOT);
    return Math.floor(Date.now() / 1000) >= stateSlotTime;
  }

  private processAttestation =
  async (latestState: BeaconState, attestation: Attestation, attestationHash: Hash): Promise<void> => {
    const validators = getAttestingIndices(
      this.config, latestState, attestation.data, attestation.aggregationBits);
    const balances = validators.map((index) => latestState.balances[index]);
    for (let i = 0; i < validators.length; i++) {
      this.forkChoice.addAttestation(attestation.data.beaconBlockRoot, validators[i], balances[i]);
    }
    this.logger.info(`Attestation ${attestationHash.toString("hex")} passed to fork choice`);
    this.emit("processedAttestation", attestation);
  };

  private processBlock = async (job: IBlockProcessJob, blockHash: Hash): Promise<void> => {

    const isValidBlock = await this.isValidBlock(this.latestState, job.block);
    assert(isValidBlock);
    this.logger.info(`0x${blockHash.toString("hex")} is valid, running state transition...`);

    const pre = this.latestState;
    // process current slot
    const post = await this.runStateTransition(job.block, pre);

    this.logger.info(
      `Slot ${job.block.slot} Block 0x${blockHash.toString("hex")} ` +
      `State ${hashTreeRoot(this.config.types.BeaconState, post).toString("hex")} passed state transition`
    );
    await this.opPool.processBlockOperations(job.block);
    job.block.body.attestations.forEach((attestation) => {
      this.receiveAttestation(attestation);
    });

    if (this.opts.dumpState) {
      this.dumpState(job.block, pre, post);
    }

    this.metrics.currentSlot.inc(1);

    // forward processed block for additional processing
    this.emit("processedBlock", job.block);
  };

  private dumpState(block: BeaconBlock, pre: BeaconState, post: BeaconState): void {
    const baseDir = "./state-dumps/";
    const curDir = this.latestState.slot;
    const full = baseDir + curDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }

    fs.mkdirSync(baseDir + curDir);

    const sblock = serialize(this.config.types.BeaconBlock, block);
    const sPre = serialize(this.config.types.BeaconState, pre);
    const sPost = serialize(this.config.types.BeaconState, post);

    fs.writeFile(full + "/block.ssz", sblock, (e) => {
      if (e) throw e;
    });
    fs.writeFile(full + "/pre.ssz", sPre, (e) => {
      if (e) throw e;
    });
    fs.writeFile(full + "/post.ssz", sPost, (e) => {
      if (e) throw e;
    });
  }

  /**
   *
   * @param block
   * @param state
   * @param trusted if state transition should trust that block is valid
   */
  private async runStateTransition(block: BeaconBlock, state: BeaconState, trusted = false): Promise<BeaconState | null> {
    const preSlot = state.slot;
    const preFinalizedEpoch = state.finalizedCheckpoint.epoch;
    const preJustifiedEpoch = state.currentJustifiedCheckpoint.epoch;
    // Run the state transition
    let newState: BeaconState;
    const blockRoot = signingRoot(this.config.types.BeaconBlock, block);
    try {
      // if block is trusted don't verify state roots, proposer or signature
      newState = stateTransition(this.config, state, block, !trusted, !trusted, !trusted);
    } catch (e) {
      // store block root in db and terminate
      await this.db.block.storeBadBlock(blockRoot);
      this.logger.warn(`Found bad block, block root: 0x${blockRoot.toString("hex")} ` + e.message);
      return;
    }
    this.latestState = newState;
    // On successful transition, update system state
    await this.db.storeChainHead(block, newState);
    this.forkChoice.addBlock(block.slot, blockRoot, block.parentRoot);
    // await this.applyForkChoiceRule();
    await this.updateDepositMerkleTree(newState);
    // update metrics
    this.metrics.currentSlot.set(block.slot);

    // Post-epoch processing
    const currentEpoch = computeEpochOfSlot(this.config, newState.slot);
    if (computeEpochOfSlot(this.config, preSlot) < currentEpoch) {
      this.emit("processedCheckpoint", {epoch: currentEpoch, root: blockRoot});
      // Update FFG Checkpoints
      // Newly justified epoch
      if (preJustifiedEpoch < newState.currentJustifiedCheckpoint.epoch) {
        const justifiedBlockRoot = newState.currentJustifiedCheckpoint.root;
        const justifiedBlock = await this.db.block.get(justifiedBlockRoot);
        this.logger.important(`Epoch ${computeEpochOfSlot(this.config, justifiedBlock.slot)} is justified!`);
        await Promise.all([
          this.db.chain.setJustifiedStateRoot(justifiedBlock.stateRoot),
          this.db.chain.setJustifiedBlockRoot(justifiedBlockRoot),
        ]);
        this.forkChoice.setJustified(justifiedBlockRoot);
        this.emit("justifiedCheckpoint", newState.currentJustifiedCheckpoint);
      }
      // Newly finalized epoch
      if (preFinalizedEpoch < newState.finalizedCheckpoint.epoch) {
        const finalizedBlockRoot = newState.finalizedCheckpoint.root;
        const finalizedBlock = await this.db.block.get(finalizedBlockRoot);
        this.logger.important(`Epoch ${computeEpochOfSlot(this.config, finalizedBlock.slot)} is finalized!`);
        await Promise.all([
          this.db.chain.setFinalizedStateRoot(finalizedBlock.stateRoot),
          this.db.chain.setFinalizedBlockRoot(finalizedBlockRoot),
        ]);
        this.forkChoice.setFinalized(finalizedBlockRoot);
        this.emit("finalizedCheckpoint", newState.finalizedCheckpoint);
      }
      this.metrics.previousJustifiedEpoch.set(newState.previousJustifiedCheckpoint.epoch);
      this.metrics.currentJustifiedEpoch.set(newState.currentJustifiedCheckpoint.epoch);
      this.metrics.currentFinalizedEpoch.set(newState.finalizedCheckpoint.epoch);
      this.metrics.currentEpochLiveValidators.set(
        newState.validators.filter((v) => isActiveValidator(v, currentEpoch)).length
      );
    }
    return newState;
  }

  private async updateDepositMerkleTree(newState: BeaconState): Promise<void> {
    const [deposits, merkleTree] = await Promise.all([
      this.db.deposit.getAll(),
      this.db.merkleTree.getProgressiveMerkleTree(
        this.config,
        newState.eth1DepositIndex
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
          hashTreeRoot(this.config.types.DepositData, deposit.data)
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
    const merkleTree = ProgressiveMerkleTree.empty(
      DEPOSIT_CONTRACT_TREE_DEPTH,
      new MerkleTreeSerialization(this.config)
    );
    const depositsWithProof = deposits
      .map((deposit, index) => {
        merkleTree.add(index, hashTreeRoot(this.config.types.DepositData, deposit.data));
        return deposit;
      })
      .map((deposit, index) => {
        deposit.proof = merkleTree.getProof(index);
        return deposit;
      });
    const genesisState = initializeBeaconStateFromEth1(
      this.config,
      Buffer.from(eth1Block.hash.replace("0x", ""), "hex"),
      eth1Block.timestamp,
      depositsWithProof
    );
    if (!isValidGenesisState(this.config, genesisState)) {
      this.logger.info(`Eth1 block ${eth1Block.hash} is NOT forming valid genesis state`);
      return;
    }
    this.logger.info(`Initializing beacon chain with eth1 block ${eth1Block.hash}`);
    await this.initializeBeaconChain(genesisState, merkleTree);
  };
}
