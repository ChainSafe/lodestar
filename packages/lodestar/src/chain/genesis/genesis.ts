/**
 * @module chain/genesis
 */

import {TreeBacked, List, fromHexString} from "@chainsafe/ssz";
import {BeaconState, Deposit, Number64, Bytes32, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {AbortSignal} from "abort-controller";
import {getTemporaryBlockHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {
  IDepositEvent,
  IEth1StreamParams,
  IEth1Provider,
  getDepositsAndBlockStreamForGenesis,
  getDepositsStream,
} from "../../eth1";
import {IGenesisBuilder, IGenesisBuilderKwargs, IGenesisResult} from "./interface";
import {
  getGenesisBeaconState,
  getEmptyBlock,
  applyDeposits,
  applyTimestamp,
  applyEth1BlockHash,
  isValidGenesisState,
  isValidGenesisValidators,
} from "./util";

export class GenesisBuilder implements IGenesisBuilder {
  private readonly config: IBeaconConfig;
  private readonly eth1Provider: IEth1Provider;
  private readonly logger: ILogger;
  private readonly signal?: AbortSignal;
  private readonly eth1Params: IEth1StreamParams;
  private state: TreeBacked<BeaconState>;
  private depositTree: TreeBacked<List<Root>>;
  private depositCache: Set<number>;

  constructor(config: IBeaconConfig, {eth1Provider, logger, signal, MAX_BLOCKS_PER_POLL}: IGenesisBuilderKwargs) {
    this.config = config;
    this.eth1Provider = eth1Provider;
    this.logger = logger;
    this.signal = signal;
    this.eth1Params = {
      ...config.params,
      MAX_BLOCKS_PER_POLL: MAX_BLOCKS_PER_POLL || 10000,
    };

    this.state = getGenesisBeaconState(
      config,
      config.types.Eth1Data.defaultValue(),
      getTemporaryBlockHeader(config, getEmptyBlock())
    );
    this.depositTree = config.types.DepositDataRootList.tree.defaultValue();
    this.depositCache = new Set<number>();
  }

  /**
   * Get eth1 deposit events and blocks and apply to this.state until we found genesis.
   */
  public async waitForGenesis(): Promise<IGenesisResult> {
    await this.eth1Provider.validateContract();

    // TODO: Load data from data from this.db.depositData, this.db.depositDataRoot
    // And start from a more recent fromBlock
    const blockNumberLastestInDb = this.eth1Provider.deployBlock;

    const blockNumberValidatorGenesis = await this.waitForGenesisValidators(blockNumberLastestInDb);

    const depositsAndBlocksStream = getDepositsAndBlockStreamForGenesis(
      blockNumberValidatorGenesis,
      this.eth1Provider,
      this.eth1Params,
      this.signal
    );

    for await (const [depositEvents, block] of depositsAndBlocksStream) {
      this.applyDeposits(depositEvents);
      applyTimestamp(this.config, this.state, block.timestamp);
      applyEth1BlockHash(this.config, this.state, fromHexString(block.hash));
      if (isValidGenesisState(this.config, this.state)) {
        this.logger.info(`Found genesis state at eth1 block ${block.number}`);
        return {
          state: this.state,
          depositTree: this.depositTree,
          block,
        };
      } else {
        this.logger.info(`Waiting for min genesis time ${block.timestamp} / ${this.config.params.MIN_GENESIS_TIME}`);
      }
    }

    throw Error("depositsStream stopped without a valid genesis state");
  }

  /**
   * First phase of waiting for genesis.
   * Stream deposits events in batches as big as possible without querying block data
   * @returns Block number at which there are enough active validators is state for genesis
   */
  private async waitForGenesisValidators(fromBlock: number): Promise<number> {
    const depositsStream = getDepositsStream(fromBlock, this.eth1Provider, this.eth1Params, this.signal);

    for await (const {depositEvents, blockNumber} of depositsStream) {
      this.applyDeposits(depositEvents);
      if (isValidGenesisValidators(this.config, this.state)) {
        this.logger.info(`Found enough validators at eth1 block ${blockNumber}`);
        return blockNumber;
      } else {
        this.logger.info(
          `Found ${this.state.validators.length} / ${this.config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT} validators to genesis`
        );
      }
    }

    throw Error("depositsStream stopped without a valid genesis state");
  }

  private applyDeposits(depositEvents: IDepositEvent[]): void {
    const newDeposits = depositEvents
      .filter((depositEvent) => !this.depositCache.has(depositEvent.index))
      .map((depositEvent) => {
        this.depositCache.add(depositEvent.index);
        this.depositTree.push(this.config.types.DepositData.hashTreeRoot(depositEvent));
        return {
          proof: this.depositTree.tree().getSingleProof(this.depositTree.gindexOfProperty(depositEvent.index)),
          data: depositEvent,
        };
      });

    applyDeposits(this.config, this.state, newDeposits, this.depositTree);

    // TODO: If necessary persist deposits here to this.db.depositData, this.db.depositDataRoot
  }
}

/**
 * Mainly used for spec test.
 * @param config
 * @param eth1BlockHash
 * @param eth1Timestamp
 * @param deposits
 */
export function initializeBeaconStateFromEth1(
  config: IBeaconConfig,
  eth1BlockHash: Bytes32,
  eth1Timestamp: Number64,
  deposits: Deposit[]
): TreeBacked<BeaconState> {
  const state = getGenesisBeaconState(
    config,
    config.types.Eth1Data.defaultValue(),
    getTemporaryBlockHeader(config, getEmptyBlock())
  );

  applyTimestamp(config, state, eth1Timestamp);
  applyEth1BlockHash(config, state, eth1BlockHash);

  // Process deposits
  applyDeposits(config, state, deposits);

  return state;
}
