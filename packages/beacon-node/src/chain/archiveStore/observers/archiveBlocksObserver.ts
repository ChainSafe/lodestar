import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/interface.js";
import {QueueObserver} from "../../../system.js";
import {IClock} from "../../../util/clock.js";
import {LightClientServer} from "../../lightClient/index.js";
import {archiveBlocks} from "../archiveBlocks.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";

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
  }
}
