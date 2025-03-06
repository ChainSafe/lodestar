import {CheckpointWithHex} from "@lodestar/fork-choice";
import {QueueObserver} from "../../observer.js";
import {PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN} from "../constants.js";
import {FrequentStateArchiveModules, maybeArchiveState} from "../utils/frequentStateArchive.js";

export class FrequentStateArchiveObserver extends QueueObserver {
  protected archiveStateEpochFrequency: number;

  constructor(
    protected modules: FrequentStateArchiveModules,
    {signal, archiveStateEpochFrequency}: {signal: AbortSignal; archiveStateEpochFrequency: number}
  ) {
    super({logger: modules.logger, maxQueueLength: PROCESS_FINALIZED_CHECKPOINT_QUEUE_LEN, signal});
    this.archiveStateEpochFrequency = archiveStateEpochFrequency;
  }

  async onForkChoiceFinalized(finalized: CheckpointWithHex): Promise<void> {
    // should execute after archiveBlocksObserver to handle restart cleanly
    await maybeArchiveState(this.modules, {archiveStateEpochFrequency: this.archiveStateEpochFrequency}, finalized);
  }
}
