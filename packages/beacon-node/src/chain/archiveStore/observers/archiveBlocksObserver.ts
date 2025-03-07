import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/interface.js";
import {IClock} from "../../../util/clock.js";
import {LightClientServer} from "../../lightClient/index.js";
import {BaseObserver} from "../../observer.js";
import {archiveBlocks} from "../utils/archiveBlocks.js";

export class ArchiveBlocksObserver extends BaseObserver {
  constructor(
    protected modules: {
      config: BeaconConfig;
      db: IBeaconDb;
      forkChoice: IForkChoice;
      lightClientServer?: LightClientServer;
      logger: Logger;
      clock: IClock;
    },
    protected opts: {archiveBlobEpochs?: number}
  ) {
    super({logger: modules.logger});
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
