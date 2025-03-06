import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/interface.js";
import {IClock} from "../../../util/clock.js";
import {LightClientServer} from "../../lightClient/index.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";
import {archiveBlocks} from "../utils/archiveBlocks.js";
import { QueueObserver } from "../../observer.js";

export class ArchiveBlocksObserver extends QueueObserver {
  constructor(
    protected modules: {
      config: BeaconConfig;
      db: IBeaconDb;
      forkChoice: IForkChoice;
      lightClientServer?: LightClientServer;
      logger: Logger;
      clock: IClock;
    },
    protected opts: {signal: AbortSignal; archiveBlobEpochs?: number}
  ) {
    super({maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN, signal: opts.signal, logger: modules.logger});
  }

  async onForkChoiceFinalized(finalized: CheckpointWithHex): Promise<void> {
    this.logger.verbose("Start archiving blocks", {epoch: finalized.epoch, rootHex: finalized.rootHex});
    try {
      await archiveBlocks(
        this.modules.config,
        this.modules.db,
        this.modules.forkChoice,
        this.modules.lightClientServer,
        this.modules.logger,
        finalized,
        this.modules.clock.currentEpoch,
        this.opts.archiveBlobEpochs
      );
    } catch (err) {
      this.logger.error("Error archiving blocks", {epoch: finalized.epoch, rootHex: finalized.rootHex}, err as Error);
    }
  }
}
