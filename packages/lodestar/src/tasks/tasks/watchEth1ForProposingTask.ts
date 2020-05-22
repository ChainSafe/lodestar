import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconDb} from "../../db";
import {IEth1Notifier, IDepositEvent} from "../../eth1";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import pipe from "it-pipe";
import abortable from "abortable-iterator";
import {AbortController} from "abort-controller";
import {IBeaconSync} from "../../sync";
import {Eth1Data} from "@chainsafe/lodestar-types";

export interface IWatchEth1ForProposingModules {
  logger: ILogger;
  db: IBeaconDb;
  eth1: IEth1Notifier;
  sync: IBeaconSync;
}
export class WatchEth1ForProposingTask {
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly db: IBeaconDb;
  private readonly eth1: IEth1Notifier;
  private readonly sync: IBeaconSync;
  private controller: AbortController = new AbortController();
  private isInitSyncing: boolean;

  public constructor(config: IBeaconConfig, modules: IWatchEth1ForProposingModules) {
    this.config = config;
    this.db = modules.db;
    this.logger = modules.logger;
    this.eth1 = modules.eth1;
    this.sync = modules.sync;
    this.isInitSyncing = true;
  }
  public async start(): Promise<void> {
    this.sync.on("initialsync:completed", this.finishInitSync);
    const startEth1BlockNumber = await this.db.getLastProcessedEth1BlockNumber();
    const eth1DataStream = await this.eth1.getDepositEventsFromBlock(false, startEth1BlockNumber);
    if (!eth1DataStream) {
      this.logger
        .warn(`watchEth1: No need to run WatchEth1ForProposingTask task startEth1BlockNumber=${startEth1BlockNumber}`);
      return;
    }
    const abortSignal = this.controller.signal;
    pipe(eth1DataStream,
      //middleware to allow to stop pipe
      function (source: AsyncIterable<IDepositEvent[]>) {
        return abortable(source, abortSignal, {returnOnAbort: true});
      },
      this.storeDepositDataRoots(),
      this.transformToProposingData(),
      this.storeProposingData(),
    );
  }

  public async stop(): Promise<void> {
    this.sync.removeListener("initialsync:completed", this.finishInitSync);
    this.controller.abort();
  }

  public finishInitSync(): void {
    this.isInitSyncing = false;
  }

  public async newFinalizedCheckpoint(): Promise<void> {
    const lastFinalizedState = await this.db.stateArchive.lastValue();
    const eth1BlockHash = toHexString(lastFinalizedState.eth1Data.blockHash);
    const depositCount = lastFinalizedState.eth1Data.depositCount;
    const eth1Timestamp = (await this.eth1.getBlock(eth1BlockHash)).number;
    await Promise.all([
      this.db.eth1Data.deleteOld(eth1Timestamp),
      this.db.depositData.deleteOld(depositCount)
    ]);
    this.logger.info(`watchEth1: Deleted old eth1Data and deposit up to eth1 block ${eth1BlockHash} ` +
    `timestamp=${eth1Timestamp}`);
  }

  /**
   * Store last processed eth1 block number and deposit data roots.
   */
  private storeDepositDataRoots(): ((source: AsyncIterable<IDepositEvent[]>) => AsyncIterable<IDepositEvent[]>) {
    const {db, config, logger} = this;
    const getIsInitSync = this.getIsInitSync.bind(this);
    return (source: AsyncIterable<IDepositEvent[]>): AsyncIterable<IDepositEvent[]> => {
      return async function* () {
        for await (const depositEvents of source) {
          if (getIsInitSync()) {
            await Promise.all([
              db.setLastProcessedEth1BlockNumber(depositEvents[depositEvents.length - 1].blockNumber),
              db.depositDataRoot.batchPut(depositEvents.map((depositEvent) => ({
                key: depositEvent.index,
                value: config.types.DepositData.hashTreeRoot(depositEvent),
              }))),
            ]);
          } else {
            await db.depositDataRoot.batchPut(depositEvents.map((depositEvent) => ({
              key: depositEvent.index,
              value: config.types.DepositData.hashTreeRoot(depositEvent),
            })));
            // next transform should save last processed eth1 block number
            const lastBlockNumber = depositEvents[depositEvents.length - 1].blockNumber;
            const firstBlockNumber = depositEvents[0].blockNumber;
            for (let blockNumber = firstBlockNumber; blockNumber <= lastBlockNumber; blockNumber++) {
              const blockDepositEvents = depositEvents.filter(event => event.blockNumber === blockNumber);
              if (blockDepositEvents.length > 0) {
                logger.info(`watchEth1: Found ${blockDepositEvents.length} deposit events for block ${blockNumber}`);
                yield blockDepositEvents;
              }
            }
          }
        }// end for
      }();
    };
  }

  /**
   * Transform to [block number, timestamp, eth1 data, deposit events of block]
   */
  private transformToProposingData():
  ((source: AsyncIterable<IDepositEvent[]>) => AsyncIterable<[number, number, Eth1Data, IDepositEvent[]]>) {
    const {eth1, db} = this;
    return (source: AsyncIterable<IDepositEvent[]>): AsyncIterable<[number, number, Eth1Data, IDepositEvent[]]> => {
      return async function* () {
        for await (const depositEvents of source) {
          const blockNumber = depositEvents[0].blockNumber;
          const block = await eth1.getBlock(depositEvents[0].blockNumber);
          const depositCount = depositEvents[depositEvents.length - 1].index + 1;
          const depositTree = await db.depositDataRoot.getTreeBacked(depositCount - 1);
          const eth1Data: Eth1Data = {
            blockHash: fromHexString(block.hash),
            depositRoot: depositTree.tree().root,
            depositCount,
          };
          const result: [number, number, Eth1Data, IDepositEvent[]] =
            [blockNumber, block.timestamp, eth1Data, depositEvents];
          yield result;
        }
      }();
    };
  }

  /**
   * Store eth1 data and deposit data.
   * Deposit events from source are grouped by block already.
   * Input stream is of type [block number, timestamp, eth1data, deposit events of block]
   */
  private storeProposingData():
  ((source: AsyncIterable<[number, number, Eth1Data, IDepositEvent[]]>) => Promise<void>) {
    return (async (source: AsyncIterable<[number, number, Eth1Data, IDepositEvent[]]>): Promise<void> => {
      for await (const data of source) {
        await Promise.all([
          this.db.setLastProcessedEth1BlockNumber(data[0]),
          this.db.eth1Data.put(data[1], data[2]),
          this.db.depositData.batchPut(data[3].map((depositEvent) => ({
            key: depositEvent.index,
            value: depositEvent,
          })))
        ]);
      }// end for
    });
  }

  private getIsInitSync(): boolean {
    return this.isInitSyncing;
  }
}