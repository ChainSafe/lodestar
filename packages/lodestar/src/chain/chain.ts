/**
 * @module chain
 */

import assert from "assert";
import {EventEmitter} from "events";
import {fromHexString, toHexString, TreeBacked, List} from "@chainsafe/ssz";
import {
  Attestation,
  BeaconState,
  Root,
  SignedBeaconBlock,
  Slot,
  Uint16,
  Uint64,
  Validator,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {EMPTY_SIGNATURE, GENESIS_SLOT} from "../constants";
import {IBeaconDb} from "../db";
import {IEth1Notifier} from "../eth1";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../metrics";
import {getEmptyBlock, initializeBeaconStateFromEth1, isValidGenesisState} from "./genesis/genesis";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentSlot,
  isActiveValidator,
  processSlots,
  stateTransition
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILMDGHOST, StatefulDagLMDGHOST} from "./forkChoice";

import {ChainEventEmitter, IAttestationProcessor, IBeaconChain} from "./interface";
import {IChainOptions} from "./options";
import {OpPool} from "../opPool";
import {Block} from "ethers/providers";
import FastPriorityQueue from "fastpriorityqueue";
import {AttestationProcessor} from "./attestation";
import {sleep} from "../util/sleep";
import {IBeaconClock} from "./clock/interface";
import {LocalClock} from "./clock/local/LocalClock";

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
  public clock: IBeaconClock;

  private readonly config: IBeaconConfig;
  private db: IBeaconDb;
  private opPool: OpPool;
  private eth1: IEth1Notifier;
  private logger: ILogger;
  private metrics: IBeaconMetrics;
  private opts: IChainOptions;
  private blockProcessingQueue: FastPriorityQueue<IBlockProcessJob>; //sort by slot number
  private attestationProcessor: IAttestationProcessor;
  private isPollingBlocks = false;

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
    this.clock = new LocalClock(this.config, this.latestState.genesisTime);
    await this.clock.start();
    this.isPollingBlocks = true;
    this.pollBlock();
  }

  public async stop(): Promise<void> {
    await this.forkChoice.stop();
    await this.clock.stop();
    this.eth1.removeListener("block", this.checkGenesis);
    this.isPollingBlocks = false;
    this.logger.warn(`Discarding ${this.blockProcessingQueue.size} blocks from queue...`);
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
    const hexBlockHash = toHexString(blockHash);
    this.logger.info(
      `Received block with hash ${hexBlockHash}` +
      `at slot ${signedBlock.message.slot}. Current state slot ${this.latestState.slot}`
    );

    if (!await this.db.block.has(signedBlock.message.parentRoot.valueOf() as Uint8Array)) {
      this.logger.warn(`Block ${blockHash} existed already, no need to process it.`);
      return;
    }

    if (await this.db.block.has(blockHash)) {
      this.logger.warn(`Block ${hexBlockHash} existed already, no need to process it.`);
      return;
    }
    const finalizedCheckpoint = this.forkChoice.getFinalized();
    if (signedBlock.message.slot <= computeStartSlotAtEpoch(this.config, finalizedCheckpoint.epoch)) {
      this.logger.warn(
        `Block ${hexBlockHash} is not after ` +
        `finalized checkpoint ${toHexString(finalizedCheckpoint.root)}.`
      );
      return;
    }

    this.blockProcessingQueue.add({signedBlock, trusted});
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
      await this.db.updateChainHead(headRoot, signedBlock.message.stateRoot.valueOf() as Uint8Array);
      this.logger.info(`Fork choice changed head to 0x${toHexString(headRoot)}`);
    }
  }

  public async initializeBeaconChain(
    genesisState: BeaconState,
    depositDataRootList: TreeBacked<List<Root>>
  ): Promise<void> {
    const genesisBlock = getEmptyBlock();
    const stateRoot = this.config.types.BeaconState.hashTreeRoot(genesisState);
    genesisBlock.stateRoot = stateRoot;
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(genesisBlock);
    this.logger.info(`Initializing beacon chain with state root ${toHexString(stateRoot)}`
            + ` and genesis block root ${toHexString(blockRoot)}`
    );
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
      this.db.depositDataRootList.set(genesisState.eth1DepositIndex, depositDataRootList)
    ]);
    const justifiedFinalizedCheckpoint = {
      root: blockRoot,
      epoch: computeEpochAtSlot(this.config, genesisBlock.slot)
    };
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

    return getCurrentSlot(this.config, state.genesisTime) >= signedBlock.message.slot;
  }

  private processBlock = async (job: IBlockProcessJob, blockHash: Root): Promise<void> => {
    const parentBlock = await this.db.block.get(job.signedBlock.message.parentRoot.valueOf() as Uint8Array);
    const pre = await this.db.state.get(parentBlock.message.stateRoot.valueOf() as Uint8Array);
    const isValidBlock = await this.isValidBlock(pre, job.signedBlock);
    assert(isValidBlock);
    const hexBlockHash = toHexString(blockHash);
    this.logger.info(`${hexBlockHash} is valid, running state transition...`);

    // process current slot
    const post = await this.runStateTransition(job.signedBlock, pre);

    this.logger.info(
      `Slot ${job.signedBlock.message.slot} Block ${hexBlockHash} ` +
      `State ${toHexString(this.config.types.BeaconState.hashTreeRoot(post))} passed state transition`
    );
    await this.opPool.processBlockOperations(job.signedBlock);
    job.signedBlock.message.body.attestations.forEach((attestation: Attestation) => {
      this.receiveAttestation(attestation);
    });
    await this.attestationProcessor.receiveBlock(job.signedBlock);

    this.metrics.currentSlot.inc(1);

    // forward processed block for additional processing
    this.emit("processedBlock", job.signedBlock);
  };

  /**
   *
   * @param signedBlock
   * @param state
   * @param trusted if state transition should trust that block is valid
   */
  private async runStateTransition(
    signedBlock: SignedBeaconBlock,
    state: BeaconState,
    trusted = false
  ): Promise<BeaconState | null> {
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
      this.logger.warn(`Found bad block, block root: ${toHexString(blockRoot)} ` + e.message);
      return;
    }
    this.latestState = newState;
    // On successful transition, update system state
    await Promise.all([
      this.db.state.set(signedBlock.message.stateRoot.valueOf() as Uint8Array, newState),
      this.db.block.set(blockRoot, signedBlock),
    ]);
    this.forkChoice.addBlock(
      signedBlock.message.slot,
      blockRoot,
      signedBlock.message.parentRoot.valueOf() as Uint8Array,
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
        const justifiedBlock = await this.db.block.get(justifiedBlockRoot.valueOf() as Uint8Array);
        this.logger.important(`Epoch ${computeEpochAtSlot(this.config, justifiedBlock.message.slot)} is justified!`);
        await Promise.all([
          this.db.chain.setJustifiedStateRoot(justifiedBlock.message.stateRoot.valueOf() as Uint8Array),
          this.db.chain.setJustifiedBlockRoot(justifiedBlockRoot.valueOf() as Uint8Array),
        ]);
        this.emit("justifiedCheckpoint", newState.currentJustifiedCheckpoint);
      }
      // Newly finalized epoch
      if (preFinalizedEpoch < newState.finalizedCheckpoint.epoch) {
        const finalizedBlockRoot = newState.finalizedCheckpoint.root;
        const finalizedBlock = await this.db.block.get(finalizedBlockRoot.valueOf() as Uint8Array);
        this.logger.important(`Epoch ${computeEpochAtSlot(this.config, finalizedBlock.message.slot)} is finalized!`);
        await Promise.all([
          this.db.chain.setFinalizedStateRoot(finalizedBlock.message.stateRoot.valueOf() as Uint8Array),
          this.db.chain.setFinalizedBlockRoot(finalizedBlockRoot.valueOf() as Uint8Array),
        ]);
        this.emit("finalizedCheckpoint", newState.finalizedCheckpoint);
      }
      this.metrics.previousJustifiedEpoch.set(newState.previousJustifiedCheckpoint.epoch);
      this.metrics.currentJustifiedEpoch.set(newState.currentJustifiedCheckpoint.epoch);
      this.metrics.currentFinalizedEpoch.set(newState.finalizedCheckpoint.epoch);
      this.metrics.currentEpochLiveValidators.set(
        Array.from(newState.validators).filter((v: Validator) => isActiveValidator(v, currentEpoch)).length
      );
    }
    return newState;
  }

  private async updateDepositMerkleTree(newState: BeaconState): Promise<void> {
    const upperIndex = newState.eth1DepositIndex + Math.min(
      this.config.params.MAX_DEPOSITS,
      newState.eth1Data.depositCount - newState.eth1DepositIndex
    );
    const [depositDatas, depositDataRootList] = await Promise.all([
      this.db.depositData.getAllBetween(newState.eth1DepositIndex, upperIndex),
      this.db.depositDataRootList.get(newState.eth1DepositIndex),
    ]);

    depositDataRootList.push(...depositDatas.map(this.config.types.DepositData.hashTreeRoot));
    //TODO: remove deposits with index <= newState.depositIndex
    await this.db.depositDataRootList.set(newState.eth1DepositIndex, depositDataRootList);
  }

  private checkGenesis = async (eth1Block: Block): Promise<void> => {
    this.logger.info(`Checking if block ${eth1Block.hash} will form valid genesis state`);
    const depositDatas = await this.opPool.depositData.getAll();
    const depositDataRootList = this.config.types.DepositDataRootList.tree.defaultValue();
    depositDataRootList.push(...depositDatas.map(this.config.types.DepositData.hashTreeRoot));
    const tree = depositDataRootList.tree();

    const genesisState = initializeBeaconStateFromEth1(
      this.config,
      fromHexString(eth1Block.hash),
      eth1Block.timestamp,
      depositDatas.map((data, index) => {
        return {
          proof: tree.getSingleProof(depositDataRootList.gindexOfProperty(index)),
          data,
        };
      })
    );
    if (!isValidGenesisState(this.config, genesisState)) {
      this.logger.info(`Eth1 block ${eth1Block.hash} is NOT forming valid genesis state`);
      return;
    }
    this.logger.info(`Initializing beacon chain with eth1 block ${eth1Block.hash}`);
    await this.initializeBeaconChain(genesisState, depositDataRootList);
  };

  /**
     * To prevent queue process stalling (if it receives multiple blocks at same time),
     * this introduces continuous queue processing. If there is block ready it will be processed sequentially
     * and if next block is missing or errors, it will stall for 500ms.
     */
  private pollBlock = async (): Promise<void> => {
    if (!this.isPollingBlocks) {
      return;
    }
    const nextBlockInQueue = this.blockProcessingQueue.poll();
    if (!nextBlockInQueue) {
      setTimeout(this.pollBlock, 1000);
      return;
    }
    try {
      const latestBlock = await this.db.block.getChainHead();
      if (this.config.types.Root.equals(
        nextBlockInQueue.signedBlock.message.parentRoot,
        this.config.types.BeaconBlock.hashTreeRoot(latestBlock.message)
      )) {
        await this.processBlock(
          nextBlockInQueue,
          this.config.types.BeaconBlock.hashTreeRoot(nextBlockInQueue.signedBlock.message)
        );
      } else {
        this.blockProcessingQueue.add(nextBlockInQueue);
        await sleep(500);
      }
    } catch (e) {
      this.logger.error(e.message);
      await sleep(500);
    }
    this.pollBlock();
  };
}
