import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {IBeaconChain} from "../interface.js";
import {ArchiveMode, ArchiverOpts} from "./interface.js";
import {ArchiveBlocksObserver} from "./observers/archiveBlocksObserver.js";
import {BackFillObserver} from "./observers/backFillObserver.js";
import {FrequentStateArchiveObserver} from "./observers/frequentStateArchvieObserver.js";
import {PruneHotStateObserver} from "./observers/pruneHotStateObserver.js";
import { archiveState } from "./utils/frequentStateArchive.js";

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiveStore {
  private archiveMode: ArchiveMode;

  private prevFinalized: CheckpointWithHex;
  private archiveBlobEpochs?: number;

  constructor(
    private readonly db: IBeaconDb,
    private readonly chain: IBeaconChain,
    private readonly logger: Logger,
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
  }

  /** Archive latest finalized state */
  async persistToDisk(): Promise<void> {
    return archiveState({bufferPool: this.chain.bufferPool, db: this.db, logger: this.logger, regen: this.chain.regen, metrics: this.metrics}, this.chain.forkChoice.getFinalizedCheckpoint());
  }
}
