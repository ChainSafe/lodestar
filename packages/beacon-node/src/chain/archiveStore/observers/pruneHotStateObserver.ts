import {CheckpointWithHex, IForkChoice} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/logger";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Checkpoint} from "@lodestar/types/lib/phase0/types.js";
import {ChainObserver} from "../../../system.js";
import {IStateRegenerator} from "../../regen/interface.js";

export class PruneHotStateObserver extends ChainObserver {
  constructor(private modules: {forkChoice: IForkChoice; regen: IStateRegenerator; logger: Logger}) {
    super({logger: modules.logger});
  }

  onCheckpoint(_checkpoint: Checkpoint, _state: CachedBeaconStateAllForks): void {
    const headStateRoot = this.modules.forkChoice.getHead().stateRoot;
    this.modules.regen.pruneOnCheckpoint(
      this.modules.forkChoice.getFinalizedCheckpoint().epoch,
      this.modules.forkChoice.getJustifiedCheckpoint().epoch,
      headStateRoot
    );
  }

  onForkChoiceFinalized(finalized: CheckpointWithHex): void {
    const finalizedEpoch = finalized.epoch;

    this.modules.regen.pruneOnFinalized(finalizedEpoch);
    const prunedBlocks = this.modules.forkChoice.prune(finalized.rootHex);

    this.logger.verbose("Finish pruning hot state on finalized checkpoint", {
      epoch: finalizedEpoch,
      rootHex: finalized.rootHex,
      prunedBlocks: prunedBlocks.length,
    });
  }
}
