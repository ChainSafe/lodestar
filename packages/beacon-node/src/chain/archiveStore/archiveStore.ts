import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {IBeaconChain} from "../interface.js";
import {MediatorQueueObserver} from "../observer.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "./constants.js";
import {ArchiveMode, ArchiverOpts} from "./interface.js";
import {ArchiveBlocksObserver} from "./observers/archiveBlocksObserver.js";
import {BackFillObserver} from "./observers/backFillObserver.js";
import {FrequentStateArchiveObserver} from "./observers/frequentStateArchiveObserver.js";
import {PruneHistoryObserver} from "./observers/pruneHistoryObserver.js";
import {PruneUnfinalizedStateObserver} from "./observers/pruneUnfinalizedStateObserver.js";
import {archiveState} from "./utils/frequentStateArchive.js";

/**
 * Used for running tasks that depends on some events or are executed
 * periodically.
 */
export class ArchiverStore {
  private archiveMode: ArchiveMode;

  constructor(
    private readonly db: IBeaconDb,
    private readonly chain: IBeaconChain,
    private readonly logger: Logger,
    signal: AbortSignal,
    private readonly opts: ArchiverOpts,
    private readonly metrics?: Metrics | null
  ) {
    this.archiveMode = opts.archiveMode;

    if (!opts.disableArchiveOnCheckpoint) return;

    const mediator = new MediatorQueueObserver({
      // As archive logic is splitted into separate observers, and each observer event is treated
      // as it's own queue item. To keep matching with existing behavior multiplying old
      // queue length with number of observers
      maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN * 5,
      signal,
      logger,
    });

    /**
     * Observers are run in order these are registered to mediator
     */
    const archiveBlocksObserver = new ArchiveBlocksObserver(
      {
        forkChoice: this.chain.forkChoice,
        clock: this.chain.clock,
        config: this.chain.config,
        lightClientServer: this.chain.lightClientServer,
        db: this.db,
        logger: this.logger,
      },
      {archiveBlobEpochs: opts.archiveBlobEpochs}
    );
    mediator.registerObserver(archiveBlocksObserver);

    const backfillObserver = new BackFillObserver({
      chain: this.chain,
      db: this.db,
      logger: this.logger,
    });
    mediator.registerObserver(backfillObserver);

    const pruneUnfinalizedStateObserver = new PruneUnfinalizedStateObserver({
      forkChoice: this.chain.forkChoice,
      regen: this.chain.regen,
      logger: this.logger,
    });
    mediator.registerObserver(pruneUnfinalizedStateObserver);

    if (this.archiveMode === ArchiveMode.Frequency) {
      // should execute after archiveBlocksObserver to handle restart cleanly
      const frequentStateArchiveObserver = new FrequentStateArchiveObserver(
        {
          db: this.db,
          logger: this.logger,
          regen: this.chain.regen,
          metrics: this.metrics,
          bufferPool: this.chain.bufferPool,
        },
        {archiveStateEpochFrequency: opts.archiveStateEpochFrequency}
      );
      mediator.registerObserver(frequentStateArchiveObserver);
    }

    if (this.opts.pruneHistory) {
      const pruneHistoryObserver = new PruneHistoryObserver({
        db: this.db,
        config: this.chain.config,
        logger: this.logger,
        clock: this.chain.clock,
        metrics: this.metrics,
      });
      mediator.registerObserver(pruneHistoryObserver);
    }

    mediator.subscribe(this.chain.emitter, signal);
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
