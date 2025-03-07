import {CheckpointWithHex} from "@lodestar/fork-choice";
import {BaseObserver} from "../../observer.js";
import {FrequentStateArchiveModules, maybeArchiveState} from "../utils/frequentStateArchive.js";

export class FrequentStateArchiveObserver extends BaseObserver {
  protected archiveStateEpochFrequency: number;

  constructor(
    protected modules: FrequentStateArchiveModules,
    {archiveStateEpochFrequency}: {archiveStateEpochFrequency: number}
  ) {
    super({logger: modules.logger});
    this.archiveStateEpochFrequency = archiveStateEpochFrequency;
  }

  async onForkChoiceFinalized(finalized: CheckpointWithHex): Promise<void> {
    // should execute after archiveBlocksObserver to handle restart cleanly
    await maybeArchiveState(this.modules, {archiveStateEpochFrequency: this.archiveStateEpochFrequency}, finalized);
  }
}
