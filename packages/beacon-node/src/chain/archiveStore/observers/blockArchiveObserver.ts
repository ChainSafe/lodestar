import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/interface.js";
import {LodestarQueueObserver} from "../../../interface.js";
import {Metrics} from "../../../metrics/metrics.js";
import {IClock} from "../../../util/clock.js";
import {ChainEvent, ChainEventEmitter} from "../../emitter.js";
import {LightClientServer} from "../../lightClient/index.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";
import {ArchiveStoreOpts} from "../interface.js";
import {archiveBlocks} from "../utils/archiveBlocks.js";

export class BlockArchiveObserver extends LodestarQueueObserver<[CheckpointWithHex], void> {
  constructor(
    protected readonly modules: {
      logger: Logger;
      db: IBeaconDb;
      config: BeaconConfig;
      forkChoice: IForkChoice;
      lightClientServer?: LightClientServer;
      clock: IClock;
      metrics: Metrics | null;
    },
    protected opts: ArchiveStoreOpts,
    signal: AbortSignal
  ) {
    super({maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN, signal, metrics: modules.metrics});
  }

  subscribe(emitter: ChainEventEmitter): void {
    if (this.opts.disableArchiveOnCheckpoint) return;

    emitter.on(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized);
  }

  unsubscribe(emitter: ChainEventEmitter): void {
    emitter.off(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized);
  }

  async onForkChoiceFinalized(checkpoint: CheckpointWithHex): Promise<void> {
    return this.processLater(checkpoint);
  }

  protected async processQueueItem(checkpoint: CheckpointWithHex): Promise<void> {
    this.modules.logger.verbose("Start processing finalized checkpoint for block archive service", {
      epoch: checkpoint.epoch,
      rootHex: checkpoint.rootHex,
    });

    await archiveBlocks(
      this.modules.config,
      this.modules.db,
      this.modules.forkChoice,
      this.modules.lightClientServer,
      this.modules.logger,
      checkpoint,
      this.modules.clock.currentEpoch,
      this.opts.archiveBlobEpochs
    );
  }
}
