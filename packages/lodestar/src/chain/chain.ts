/**
 * @module chain
 */

import assert from "assert";
import {EventEmitter} from "events";
import {
  Attestation, BeaconState, Slot, Uint16, Uint64, Root, SignedBeaconBlock,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DEPOSIT_CONTRACT_TREE_DEPTH, GENESIS_SLOT, EMPTY_SIGNATURE} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {ILogger} from  "@chainsafe/eth2.0-utils/lib/logger";
import {fromHex, toHex} from "@chainsafe/eth2.0-utils";
import {IBeaconMetrics} from "../metrics";

import {getEmptyBlock, initializeBeaconStateFromEth1, isValidGenesisState} from "./genesis/genesis";

import {
  computeEpochAtSlot,
  processSlots, stateTransition,
  computeStartSlotAtEpoch,
  isActiveValidator
  , getCurrentSlot
} from "@chainsafe/eth2.0-state-transition";
import {ILMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";

import {ChainEventEmitter, IBeaconChain, IAttestationProcessor} from "./interface";
import {processSortedDeposits} from "../util/deposits";
import {IChainOptions} from "./options";
import {OpPool} from "../opPool";
import {Block} from "ethers/providers";
import fs from "fs";
import FastPriorityQueue from "fastpriorityqueue";

import {ProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";
import {MerkleTreeSerialization} from "../util/serialization";
import {AttestationProcessor} from "./attestation";

export interface IBeaconChainModules {
  config: IBeaconConfig;
  opPool: OpPool;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  logger: ILogger;
  metrics: IBeaconMetrics;
}

export interface IBlockProcessJob {
  signedBlock: SignedBeaconBlock;
  trusted: boolean;
}

export class BeaconChain extends (EventEmitter as { new(): ChainEventEmitter }) implements IBeaconChain {

  public chain: string;
  public _latestState: BeaconState = null;
  public forkChoice: ILMDGHOST;
  public chainId: Uint16;
  public networkId: Uint64;

  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private logger: ILogger;
  private metrics: IBeaconMetrics;
  private opts: IChainOptions;
  private blockProcessingQueue: FastPriorityQueue<IBlockProcessJob>; //sort by slot number
  private attestationProcessor: IAttestationProcessor;

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
    this.forkChoice = new StatefulDagLMDGHOST(config);
    this.chainId = 0; // TODO make this real
    this.networkId = 0n; // TODO make this real
    this.blockProcessingQueue = new FastPriorityQueue((a: IBlockProcessJob, b: IBlockProcessJob) => {
      return a.signedBlock.message.slot < b.signedBlock.message.slot;
    });
    this.attestationProcessor = new AttestationProcessor(this, this.forkChoice, {config, db, logger});
  }

  public async start(): Promise<void> {
    const state = this.latestState || await this.db.state.getLatest();
    this.forkChoice.start(state.genesisTime);
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
    await this.forkChoice.stop();
    this.eth1.removeListener("block", this.checkGenesis);
  }

  public get latestState(): BeaconState {
    return this.config.types.BeaconState.clone(this._latestState);
  }

  public set latestState(state: BeaconState) {
    this._latestState = state;
  }

  public isInitialized(): boolean {
    return !!this.latestState;
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    return this.attestationProcessor.receiveAttestation(attestation);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async receiveBlock(signedBlock: SignedBeaconBlock, trusted = false): Promise<void> {
    const blockHash = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    const hexBlockHash = toHex(blockHash);
    this.logger.info(
      `Received block with hash ${hexBlockHash}` +
      `at slot ${signedBlock.message.slot}. Current state slot ${this.latestState.slot}`
    );

    if (!await this.db.block.has(signedBlock.message.parentRoot)) {
      this.emit("unknownBlockRoot", signedBlock.message.parentRoot);
      this.blockProcessingQueue.add({signedBlock, trusted});
      return;
    }

    if(await this.db.block.has(blockHash)) {
      this.logger.warn(`Block ${hexBlockHash} existed already, no need to process it.`);
      return;
    }

    const finalizedCheckpoint = this.forkChoice.getFinalized();
    if(signedBlock.message.slot <= computeStartSlotAtEpoch(this.config, finalizedCheckpoint.epoch)) {
      this.logger.warn(
        `Block ${hexBlockHash} is not after ` +
        `finalized checkpoint ${toHex(finalizedCheckpoint.root)}.`
      );
      return;
    }

    await this.processBlock({signedBlock, trusted: false}, blockHash);
    const nextBlockInQueue = this.blockProcessingQueue.peek();
    while (nextBlockInQueue) {
      if (await this.db.block.has(nextBlockInQueue.signedBlock.message.parentRoot)) {
        await this.processBlock(
          nextBlockInQueue,
          this.config.types.BeaconBlock.hashTreeRoot(nextBlockInQueue.signedBlock.message),
        );
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
    await this.db.chain.setLatestStateRoot(this.config.types.BeaconState.hashTreeRoot(state));
  }

  public async applyForkChoiceRule(): Promise<void> {
    const currentRoot = await this.db.chain.getChainHeadRoot();
    const headRoot = this.forkChoice.head();
    if (currentRoot && !this.config.types.Root.equals(currentRoot, headRoot)) {
      const signedBlock = await this.db.block.get(headRoot);
      await this.db.updateChainHead(headRoot, signedBlock.message.stateRoot);
      this.logger.info(`Fork choice changed head to 0x${toHex(headRoot)}`);
    }
  }

  public async initializeBeaconChain(genesisState: BeaconState, merkleTree: ProgressiveMerkleTree): Promise<void> {
    this.logger.info(`Initializing beacon chain with genesisTime ${genesisState.genesisTime}`);
    const genesisBlock = getEmptyBlock();
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(genesisState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(genesisBlock);
    this.latestState = genesisState;
    // Determine whether a genesis state already in
    // the database matches what we were provided
    const storedGenesisBlock = await this.db.block.getBlockBySlot(GENESIS_SLOT);
    if (storedGenesisBlock !== null &&
      !this.config.types.Root.equals(genesisBlock.stateRoot, storedGenesisBlock.message.stateRoot)) {
      throw new Error("A genesis state with different configuration was detected! Please clean the database.");
    }
    await Promise.all([
      this.db.storeChainHead({message: genesisBlock, signature: EMPTY_SIGNATURE}, genesisState),
      this.db.chain.setJustifiedBlockRoot(blockRoot),
      this.db.chain.setFinalizedBlockRoot(blockRoot),
      this.db.chain.setJustifiedStateRoot(stateRoot),
      this.db.chain.setFinalizedStateRoot(stateRoot),
      this.db.merkleTree.set(genesisState.eth1DepositIndex, merkleTree.toObject())
    ]);
    const justifiedFinalizedCheckpoint = {root: blockRoot, epoch: computeEpochAtSlot(this.config, genesisBlock.slot)};
    this.forkChoice.addBlock(genesisBlock.slot, blockRoot, Buffer.alloc(32),
      justifiedFinalizedCheckpoint, justifiedFinalizedCheckpoint);
    this.logger.info("Beacon chain initialized");
  }

  public async isValidBlock(state: BeaconState, signedBlock: SignedBeaconBlock): Promise<boolean> {
    // The parent block with root block.previous_block_root has been processed and accepted.
    // const hasParent = await this.db.block.has(block.parentRoot);
    // if (!hasParent) {
    //   return false;
    // }
    // An Ethereum 1.0 block pointed to by the state.
    // latest_eth1_data.block_hash has been processed and accepted.
    // TODO: implement

    // The node's Unix time is greater than or equal to state.
    const stateSlotTime = state.genesisTime + (
      (signedBlock.message.slot - GENESIS_SLOT) * this.config.params.SECONDS_PER_SLOT
    );
    return Math.floor(Date.now() / 1000) >= stateSlotTime;
  }

  private processBlock = async (job: IBlockProcessJob, blockHash: Root): Promise<void> => {
    const parentBlock = await this.db.block.get(job.signedBlock.message.parentRoot);
    const pre = await this.db.state.get(parentBlock.message.stateRoot);
    const isValidBlock = await this.isValidBlock(pre, job.signedBlock);
    assert(isValidBlock);
    const hexBlockHash = toHex(blockHash);
    this.logger.info(`${hexBlockHash} is valid, running state transition...`);

    // process current slot
    const post = await this.runStateTransition(job.signedBlock, pre);

    this.logger.info(
      `Slot ${job.signedBlock.message.slot} Block ${hexBlockHash} ` +
      `State ${toHex(this.config.types.BeaconState.hashTreeRoot(post))} passed state transition`
    );
    await this.opPool.processBlockOperations(job.signedBlock);
    job.signedBlock.message.body.attestations.forEach((attestation) => {
      this.receiveAttestation(attestation);
    });
    await this.attestationProcessor.receiveBlock(job.signedBlock);

    if (this.opts.dumpState) {
      this.dumpState(job.signedBlock, pre, post);
    }

    this.metrics.currentSlot.inc(1);

    // forward processed block for additional processing
    this.emit("processedBlock", job.signedBlock);
  };

  private dumpState(signedBlock: SignedBeaconBlock, pre: BeaconState, post: BeaconState): void {
    const baseDir = "./state-dumps/";
    const curDir = this.latestState.slot;
    const full = baseDir + curDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }

    fs.mkdirSync(baseDir + curDir);

    const sblock = this.config.types.SignedBeaconBlock.serialize(signedBlock);
    const sPre = this.config.types.BeaconState.serialize(pre);
    const sPost = this.config.types.BeaconState.serialize(post);

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
  private async runStateTransition(
    signedBlock: SignedBeaconBlock,
    state: BeaconState,
    trusted = false
  ): Promise<BeaconState|null> {
    const preSlot = state.slot;
    const preFinalizedEpoch = state.finalizedCheckpoint.epoch;
    const preJustifiedEpoch = state.currentJustifiedCheckpoint.epoch;
    // Run the state transition
    let newState: BeaconState;
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    try {
      // if block is trusted don't verify state roots, proposer or signature
      newState = stateTransition(this.config, state, signedBlock, !trusted, !trusted, !trusted);
    } catch (e) {
      // store block root in db and terminate
      await this.db.block.storeBadBlock(blockRoot);
      this.logger.warn(`Found bad block, block root: ${toHex(blockRoot)} ` + e.message);
      return;
    }
    this.latestState = newState;
    // On successful transition, update system state
    await Promise.all([
      this.db.state.set(signedBlock.message.stateRoot, newState),
      this.db.block.set(blockRoot, signedBlock),
    ]);
    this.forkChoice.addBlock(
      signedBlock.message.slot,
      blockRoot,
      signedBlock.message.parentRoot,
      newState.currentJustifiedCheckpoint,
      newState.finalizedCheckpoint
    );
    await this.applyForkChoiceRule();
    await this.updateDepositMerkleTree(newState);
    // update metrics
    this.metrics.currentSlot.set(signedBlock.message.slot);

    // Post-epoch processing
    const currentEpoch = computeEpochAtSlot(this.config, newState.slot);
    if (computeEpochAtSlot(this.config, preSlot) < currentEpoch) {
      this.emit("processedCheckpoint", {epoch: currentEpoch, root: blockRoot});
      // Update FFG Checkpoints
      // Newly justified epoch
      if (preJustifiedEpoch < newState.currentJustifiedCheckpoint.epoch) {
        const justifiedBlockRoot = newState.currentJustifiedCheckpoint.root;
        const justifiedBlock = await this.db.block.get(justifiedBlockRoot);
        this.logger.important(`Epoch ${computeEpochAtSlot(this.config, justifiedBlock.message.slot)} is justified!`);
        await Promise.all([
          this.db.chain.setJustifiedStateRoot(justifiedBlock.message.stateRoot),
          this.db.chain.setJustifiedBlockRoot(justifiedBlockRoot),
        ]);
        this.emit("justifiedCheckpoint", newState.currentJustifiedCheckpoint);
      }
      // Newly finalized epoch
      if (preFinalizedEpoch < newState.finalizedCheckpoint.epoch) {
        const finalizedBlockRoot = newState.finalizedCheckpoint.root;
        const finalizedBlock = await this.db.block.get(finalizedBlockRoot);
        this.logger.important(`Epoch ${computeEpochAtSlot(this.config, finalizedBlock.message.slot)} is finalized!`);
        await Promise.all([
          this.db.chain.setFinalizedStateRoot(finalizedBlock.message.stateRoot),
          this.db.chain.setFinalizedBlockRoot(finalizedBlockRoot),
        ]);
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
          this.config.types.DepositData.hashTreeRoot(deposit.data)
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
        merkleTree.add(index, this.config.types.DepositData.hashTreeRoot(deposit.data));
        return deposit;
      })
      .map((deposit, index) => {
        deposit.proof = merkleTree.getProof(index);
        return deposit;
      });
    const genesisState = initializeBeaconStateFromEth1(
      this.config,
      fromHex(eth1Block.hash),
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
