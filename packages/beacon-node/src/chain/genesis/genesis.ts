import {GENESIS_EPOCH, GENESIS_SLOT} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {toGindex, Tree} from "@chainsafe/persistent-merkle-tree";
import {
  getTemporaryBlockHeader,
  getGenesisBeaconState,
  applyDeposits,
  applyTimestamp,
  applyEth1BlockHash,
  CachedBeaconStateAllForks,
  createCachedBeaconState,
  BeaconStateAllForks,
  createEmptyEpochContextImmutableData,
  getActiveValidatorIndices,
} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {IEth1Provider} from "../../eth1/index.js";
import {IEth1StreamParams} from "../../eth1/interface.js";
import {getDepositsAndBlockStreamForGenesis, getDepositsStream} from "../../eth1/stream.js";
import {DepositTree} from "../../db/repositories/depositDataRoot.js";
import {IGenesisBuilder, GenesisResult} from "./interface.js";

export type GenesisBuilderKwargs = {
  config: ChainForkConfig;
  eth1Provider: IEth1Provider;
  logger: Logger;

  /** Use to restore pending progress */
  pendingStatus?: {
    state: BeaconStateAllForks;
    depositTree: DepositTree;
    lastProcessedBlockNumber: number;
  };

  signal?: AbortSignal;
  maxBlocksPerPoll?: number;
};

export class GenesisBuilder implements IGenesisBuilder {
  // Expose state to persist on error
  readonly state: CachedBeaconStateAllForks;
  readonly depositTree: DepositTree;
  /** Is null if no block has been processed yet */
  lastProcessedBlockNumber: number | null = null;

  private readonly config: BeaconConfig;
  private readonly eth1Provider: IEth1Provider;
  private readonly logger: Logger;
  private readonly signal?: AbortSignal;
  private readonly eth1Params: IEth1StreamParams;
  private readonly depositCache = new Set<number>();
  private readonly fromBlock: number;
  private readonly logEvery = 30 * 1000;
  private lastLog = 0;
  /** Current count of active validators in the state */
  private activatedValidatorCount: number;

  constructor({config, eth1Provider, logger, signal, pendingStatus, maxBlocksPerPoll}: GenesisBuilderKwargs) {
    // at genesis builder, there is no genesis validator so we don't have a real BeaconConfig
    // but we need BeaconConfig to temporarily create CachedBeaconState, the cast here is safe since we don't use any getDomain here
    // the use of state as CachedBeaconState is just for convenient, GenesisResult returns TreeView anyway
    this.eth1Provider = eth1Provider;
    this.logger = logger;
    this.signal = signal;
    this.eth1Params = {
      ...config,
      maxBlocksPerPoll: maxBlocksPerPoll ?? 10000,
    };

    let stateView: BeaconStateAllForks;

    if (pendingStatus) {
      this.logger.info("Restoring pending genesis state", {block: pendingStatus.lastProcessedBlockNumber});
      stateView = pendingStatus.state;
      this.depositTree = pendingStatus.depositTree;
      this.fromBlock = Math.max(pendingStatus.lastProcessedBlockNumber + 1, this.eth1Provider.deployBlock);
    } else {
      stateView = getGenesisBeaconState(
        config,
        ssz.phase0.Eth1Data.defaultValue(),
        getTemporaryBlockHeader(config, config.getForkTypes(GENESIS_SLOT).BeaconBlock.defaultValue())
      );
      this.depositTree = ssz.phase0.DepositDataRootList.defaultViewDU();
      this.fromBlock = this.eth1Provider.deployBlock;
    }

    // TODO - PENDING: Ensure EpochContextImmutableData is created only once
    this.state = createCachedBeaconState(stateView, createEmptyEpochContextImmutableData(config, stateView));
    this.config = this.state.config;
    this.activatedValidatorCount = getActiveValidatorIndices(stateView, GENESIS_EPOCH).length;
  }

  /**
   * Get eth1 deposit events and blocks and apply to this.state until we found genesis.
   */
  async waitForGenesis(): Promise<GenesisResult> {
    await this.eth1Provider.validateContract();

    // Load data from data from this.db.depositData, this.db.depositDataRoot
    // And start from a more recent fromBlock
    const blockNumberValidatorGenesis = await this.waitForGenesisValidators();

    const depositsAndBlocksStream = getDepositsAndBlockStreamForGenesis(
      blockNumberValidatorGenesis,
      this.eth1Provider,
      this.eth1Params,
      this.signal
    );

    for await (const [depositEvents, block] of depositsAndBlocksStream) {
      this.applyDeposits(depositEvents);
      applyTimestamp(this.config, this.state, block.timestamp);
      applyEth1BlockHash(this.state, block.blockHash);
      this.lastProcessedBlockNumber = block.blockNumber;

      if (
        this.state.genesisTime >= this.config.MIN_GENESIS_TIME &&
        this.activatedValidatorCount >= this.config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT
      ) {
        this.logger.info("Found genesis state", {blockNumber: block.blockNumber});
        return {
          state: this.state,
          depositTree: this.depositTree,
          block,
        };
      } else {
        this.throttledLog(`Waiting for min genesis time ${block.timestamp} / ${this.config.MIN_GENESIS_TIME}`);
      }
    }

    throw Error("depositsStream stopped without a valid genesis state");
  }

  /**
   * First phase of waiting for genesis.
   * Stream deposits events in batches as big as possible without querying block data
   * @returns Block number at which there are enough active validators is state for genesis
   */
  private async waitForGenesisValidators(): Promise<number> {
    const depositsStream = getDepositsStream(this.fromBlock, this.eth1Provider, this.eth1Params, this.signal);

    for await (const {depositEvents, blockNumber} of depositsStream) {
      this.applyDeposits(depositEvents);
      this.lastProcessedBlockNumber = blockNumber;

      if (this.activatedValidatorCount >= this.config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT) {
        this.logger.info("Found enough genesis validators", {blockNumber});
        return blockNumber;
      } else {
        this.throttledLog(
          `Found ${this.state.validators.length} / ${this.config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT} validators to genesis`
        );
      }
    }

    throw Error("depositsStream stopped without a valid genesis state");
  }

  private applyDeposits(depositEvents: phase0.DepositEvent[]): void {
    const newDeposits = depositEvents
      .filter((depositEvent) => !this.depositCache.has(depositEvent.index))
      .map((depositEvent) => {
        this.depositCache.add(depositEvent.index);
        this.depositTree.push(ssz.phase0.DepositData.hashTreeRoot(depositEvent.depositData));
        const gindex = toGindex(this.depositTree.type.depth, BigInt(depositEvent.index));

        // Apply changes from the push above
        this.depositTree.commit();
        const depositTreeNode = this.depositTree.node;
        return {
          proof: new Tree(depositTreeNode).getSingleProof(gindex),
          data: depositEvent.depositData,
        };
      });

    const {activatedValidatorCount} = applyDeposits(this.config, this.state, newDeposits, this.depositTree);
    this.activatedValidatorCount += activatedValidatorCount;

    // TODO: If necessary persist deposits here to this.db.depositData, this.db.depositDataRoot
  }

  /** Throttle genesis generation status log to prevent spamming */
  private throttledLog(message: string): void {
    if (Date.now() - this.lastLog > this.logEvery) {
      this.lastLog = Date.now();
      this.logger.info(message);
    }
  }
}
