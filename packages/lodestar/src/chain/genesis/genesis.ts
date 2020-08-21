/**
 * @module chain/genesis
 */

import {TreeBacked, List, fromHexString} from "@chainsafe/ssz";
import {BeaconState, Deposit, Number64, Bytes32, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import abortable from "abortable-iterator";
import {AbortController} from "abort-controller";
import {getTemporaryBlockHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {IDepositEvent, IEth1Streamer, Eth1Streamer, IEth1Provider} from "../../eth1";
import {IGenesisBuilder, IGenesisBuilderModules} from "./interface";
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
  private readonly db: IBeaconDb;
  private readonly eth1Provider: IEth1Provider;
  private readonly eth1: IEth1Streamer;
  private readonly logger: ILogger;
  private state: TreeBacked<BeaconState>;
  private depositTree: TreeBacked<List<Root>>;

  constructor(config: IBeaconConfig, {db, eth1Provider, logger}: IGenesisBuilderModules) {
    this.state = getGenesisBeaconState(
      config,
      config.types.Eth1Data.defaultValue(),
      getTemporaryBlockHeader(config, getEmptyBlock())
    );
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.depositTree = config.types.DepositDataRootList.tree.defaultValue();
    this.eth1Provider = eth1Provider;
    this.eth1 = new Eth1Streamer(eth1Provider, {
      ...config.params,
      MAX_BLOCKS_PER_POLL: 99,
    });
  }

  /**
   * Get eth1 deposit events and blocks and apply to this.state until we found genesis.
   */
  public async waitForGenesis(): Promise<TreeBacked<BeaconState>> {
    await this.eth1Provider.validateContract();

    // TODO: Load data from data from this.db.depositData, this.db.depositDataRoot
    // And start from a more recent fromBlock
    const blockNumberLastestInDb = 0;

    const blockNumberValidatorGenesis = await this.waitForGenesisValidators(blockNumberLastestInDb);

    const controller = new AbortController();
    const depositsAndBlocksStream = this.eth1.getDepositsAndBlockStreamForGenesis(blockNumberValidatorGenesis);
    for await (const [depositEvents, block] of abortable(depositsAndBlocksStream, controller.signal)) {
      this.applyDeposits(depositEvents);
      applyTimestamp(this.config, this.state, block.timestamp);
      applyEth1BlockHash(this.config, this.state, fromHexString(block.hash));
      if (isValidGenesisState(this.config, this.state)) {
        this.logger.info(`Found genesis state at eth1 block ${block.number}`);
        controller.abort();
        return this.state;
      }
    }

    throw Error("depositsStream stopped without a valid genesis state");
  }

  private async waitForGenesisValidators(fromBlock: number): Promise<number> {
    const controller = new AbortController();
    const depositsStream = this.eth1.getDepositsStream(fromBlock);
    for await (const {depositEvents, blockNumber} of abortable(depositsStream, controller.signal)) {
      this.applyDeposits(depositEvents);
      this.logger.verbose(`Found ${this.state.validators.length} validators to genesis so far`);
      if (isValidGenesisValidators(this.config, this.state)) {
        this.logger.info(`Found enough validators at eth1 block ${blockNumber}`);
        controller.abort();
        return blockNumber;
      }
    }

    throw Error("depositsStream stopped without a valid genesis state");
  }

  private applyDeposits(depositEvents: IDepositEvent[]): void {
    const newDeposits = depositEvents.map((depositEvent) => {
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
