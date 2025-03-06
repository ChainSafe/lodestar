import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../db/interface.js";
import {Metrics} from "../../../metrics/metrics.js";
import { QueueObserver } from "../../observer.js";
import {IClock} from "../../../util/clock.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";
import {pruneHistory} from "../utils/pruneHistory.js";

export class PruneHistoryObserver extends QueueObserver {
  constructor(
    private modules: {config: BeaconConfig; db: IBeaconDb; logger: Logger; clock: IClock; metrics?: Metrics | null},
    {signal}: {signal: AbortSignal}
  ) {
    super({logger: modules.logger, maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN, signal});
  }

  async onForkChoiceFinalized(finalized: CheckpointWithHex): Promise<void> {
    await pruneHistory(
      this.modules.config,
      this.modules.db,
      this.logger,
      this.modules.metrics,
      finalized.epoch,
      this.modules.clock.currentEpoch
    );
  }
}
