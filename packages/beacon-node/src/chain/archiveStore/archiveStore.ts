import path from "node:path";
import {chainConfigToJson} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {LoggerNode} from "@lodestar/logger/node";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {WorkerService, createWorkerService} from "../../system.js";
import {IBeaconChain} from "../interface.js";
import {ArchiveMode, ArchiverOpts, HistoricalStateApi, HistoricalStateWorkerData} from "./interface.js";
import {ArchiveBlocksObserver} from "./observers/archiveBlocksObserver.js";
import {BackFillObserver} from "./observers/backFillObserver.js";
import {FrequentStateArchiveObserver} from "./observers/frequentStateArchvieObserver.js";
import {PruneHotStateObserver} from "./observers/pruneHotStateObserver.js";
import {archiveState} from "./utils/frequentStateArchive.js";

// Worker constructor consider the path relative to the current working directory
const WORKER_DIR = process.env.NODE_ENV === "test" ? "../../../lib/chain/archiveStore/workers" : "./workers";

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiveStore {
  private archiveMode: ArchiveMode;

  private prevFinalized: CheckpointWithHex;
  private archiveBlobEpochs?: number;
  private historicalStateService: WorkerService<HistoricalStateApi>;

  constructor(
    private readonly db: IBeaconDb,
    private readonly chain: IBeaconChain,
    private readonly logger: LoggerNode,
    signal: AbortSignal,
    opts: ArchiverOpts,
    private readonly metrics?: Metrics | null
  ) {
    this.archiveMode = opts.archiveMode;
    this.archiveBlobEpochs = opts.archiveBlobEpochs;
    this.prevFinalized = chain.forkChoice.getFinalizedCheckpoint();

    if (!opts.disableArchiveOnCheckpoint) {
      const pruneHotStateObserver = new PruneHotStateObserver({
        forkChoice: this.chain.forkChoice,
        regen: this.chain.regen,
        logger: this.logger,
      });
      pruneHotStateObserver.subscribe(this.chain.emitter, signal);

      const archiveBlocksObserver = new ArchiveBlocksObserver(
        {
          forkChoice: this.chain.forkChoice,
          clock: this.chain.clock,
          config: this.chain.config,
          lightClientServer: this.chain.lightClientServer,
          db: this.db,
          logger: this.logger,
        },
        {archiveBlobEpochs: this.archiveBlobEpochs, signal}
      );
      archiveBlocksObserver.subscribe(this.chain.emitter, signal);

      const backfillObserver = new BackFillObserver(
        {
          chain: this.chain,
          db: this.db,
          logger: this.logger,
        },
        {signal}
      );
      backfillObserver.subscribe(this.chain.emitter, signal);

      if (this.archiveMode === ArchiveMode.Frequency) {
        const frequentStateArchiveObserver = new FrequentStateArchiveObserver(
          {
            db: this.db,
            logger: this.logger,
            regen: this.chain.regen,
            metrics: this.metrics,
            bufferPool: this.chain.bufferPool,
          },
          {signal, archiveStateEpochFrequency: opts.archiveStateEpochFrequency}
        );
        frequentStateArchiveObserver.subscribe(this.chain.emitter, signal);
      }
    }

    if (!opts.archiveDbPath) {
      throw new Error("Archive db path is not set");
    }

    const workerData: HistoricalStateWorkerData = {
      chainConfigJson: chainConfigToJson(this.chain.config),
      genesisValidatorsRoot: this.chain.config.genesisValidatorsRoot,
      genesisTime: this.chain.genesisTime,
      maxConcurrency: 1,
      maxLength: 50,
      archiveDbPath: opts.archiveDbPath,
      metricsEnabled: Boolean(this.metrics),
      loggerOpts: logger.toOpts(),
    };

    this.historicalStateService = createWorkerService<HistoricalStateApi, HistoricalStateWorkerData>(
      path.join(WORKER_DIR, "historicalStateWorker.js"),
      workerData,
      {
        // A Lodestar Node may do very expensive task at start blocking the event loop and causing
        // the initialization to timeout. The number below is big enough to almost disable the timeout
        timeout: 5 * 60 * 1000,
      }
    );
  }

  async start(): Promise<void> {
    await this.historicalStateService.start();
  }

  async stop(): Promise<void> {
    await this.historicalStateService.stop();
  }

  async scrapeMetrics(): Promise<string> {
    return this.historicalStateService.scrapeMetrics();
  }

  async getHistoricalState(slot: number): Promise<Uint8Array> {
    return this.historicalStateService.getHistoricalState(slot);
  }

  /** Archive latest finalized state */
  async persistToDisk(): Promise<void> {
    return archiveState(
      {
        bufferPool: this.chain.bufferPool,
        db: this.db,
        logger: this.logger,
        regen: this.chain.regen,
        metrics: this.metrics,
      },
      this.chain.forkChoice.getFinalizedCheckpoint()
    );
  }
}
