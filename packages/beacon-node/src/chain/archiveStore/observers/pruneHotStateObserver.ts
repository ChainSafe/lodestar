import {IForkChoice} from "@lodestar/fork-choice";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Checkpoint} from "@lodestar/types/lib/phase0/types.js";
import {ChainObserver} from "../../../system.js";
import {IStateRegenerator} from "../../regen/interface.js";

export class PruneHotStateObserver extends ChainObserver {
  constructor(private modules: {forkChoice: IForkChoice; regen: IStateRegenerator}) {
    super();
  }

  onCheckpoint(_checkpoint: Checkpoint, _state: CachedBeaconStateAllForks): void {
    const headStateRoot = this.modules.forkChoice.getHead().stateRoot;
    this.modules.regen.pruneOnCheckpoint(
      this.modules.forkChoice.getFinalizedCheckpoint().epoch,
      this.modules.forkChoice.getJustifiedCheckpoint().epoch,
      headStateRoot
    );
  }
}
