/**
 * @module chain/genesis
 */

import {TreeBacked, List, fromHexString} from "@chainsafe/ssz";
import {
  BeaconState,
  Deposit,
  Number64,
  Bytes32,
  Root,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {
  getTemporaryBlockHeader,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {IEth1Notifier, Eth1Block, Eth1EventsBlock} from "../../eth1";
import pipe from "it-pipe";
import {IGenesisBuilder, IGenesisBuilderModules} from "./interface";
import {
  getGenesisBeaconState,
  getEmptyBlock,
  applyDeposits,
  applyTimestamp,
  applyEth1BlockHash,
  isValidGenesisState} from "./util";

export class GenesisBuilder implements IGenesisBuilder {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly eth1: IEth1Notifier;
  private readonly logger: ILogger;
  private state: TreeBacked<BeaconState>;
  private depositTree: TreeBacked<List<Root>>;

  constructor(config: IBeaconConfig, {eth1, db, logger}: IGenesisBuilderModules) {
    this.state = getGenesisBeaconState(
      config,
      config.types.Eth1Data.defaultValue(),
      getTemporaryBlockHeader(
        config,
        getEmptyBlock()
      )
    );
    this.depositTree = config.types.DepositDataRootList.tree.defaultValue();
    this.config = config;
    this.eth1 = eth1;
    this.db = db;
    this.logger = logger;
  }

  /**
   * Get eth1 deposit events and blocks and apply to this.state until we found genesis.
   */
  public async waitForGenesis(): Promise<TreeBacked<BeaconState>> {
    await this.initialize();
    const eth1DataStream = await this.eth1.getEth1BlockAndDepositEventsSource();
    const state = await pipe(
      eth1DataStream,
      this.processDepositEvents(),
      this.assembleGenesisState()
    );
    this.eth1.endEth1BlockAndDepositEventsSource();
    return state;
  }

  private assembleGenesisState():
  (source: AsyncIterable<[Deposit[], Eth1Block]>) => Promise<TreeBacked<BeaconState>> {
    return async (source) => {
      for await (const [deposits, block] of source) {
        applyDeposits(this.config, this.state, deposits, this.depositTree);
        if (!block) {
          continue;
        }
        applyTimestamp(this.config, this.state, block.timestamp);
        applyEth1BlockHash(this.config, this.state, fromHexString(block.hash));
        const isValid = isValidGenesisState(this.config, this.state);
        if (isValid) {
          this.logger.info(`Found genesis state at eth1 block ${block.number}`);
          return this.state;
        }
      }
    };
  }

  private processDepositEvents():
  (source: AsyncIterable<Eth1EventsBlock>) => AsyncGenerator<[Deposit[], Eth1Block]> {
    return ((source) => {
      const {depositTree, config} = this;
      return async function * () {
        for await (const {events, block} of source) {
          const newDeposits: Deposit[] = events.map((depositEvent) => {
            depositTree.push(config.types.DepositData.hashTreeRoot(depositEvent));
            return {
              proof: depositTree.tree().getSingleProof(depositTree.gindexOfProperty(depositEvent.index)),
              data: depositEvent,
            };
          });
          yield [newDeposits, block] as [Deposit[], Eth1Block];
        }
      }();
    });
  }

  private async initialize(): Promise<void> {
    const depositDatas = await this.db.depositData.values() || [];
    const depositDataRoots = await this.db.depositDataRoot.values() || [];
    depositDatas.map((event, index) => {
      this.depositTree.push(depositDataRoots[index]);
      return {
        proof: this.depositTree.tree().getSingleProof(this.depositTree.gindexOfProperty(index)),
        data: event,
      };
    });
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
  deposits: Deposit[]): TreeBacked<BeaconState> {
  const state = getGenesisBeaconState(
    config,
    {
      depositCount: deposits.length,
      depositRoot: new Uint8Array(32),
      blockHash: eth1BlockHash
    },
    getTemporaryBlockHeader(
      config,
      getEmptyBlock()
    )
  );

  applyTimestamp(config, state, eth1Timestamp);

  // Process deposits
  applyDeposits(config, state, deposits);

  return state as TreeBacked<BeaconState>;
}


