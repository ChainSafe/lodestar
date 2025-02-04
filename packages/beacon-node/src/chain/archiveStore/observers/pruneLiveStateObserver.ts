import { IForkChoice } from "@lodestar/fork-choice";
import { CachedBeaconStateAllForks } from "@lodestar/state-transition";
import { Checkpoint } from "@lodestar/types/lib/phase0/types.js";
import { Logger } from "@lodestar/utils";
import { LodestarObserver } from "../../../interface.js";
import { Metrics } from "../../../metrics/metrics.js";
import { ChainEvent, ChainEventEmitter } from "../../emitter.js";
import { IStateRegenerator } from "../../regen/interface.js";

export class PruneLiveStateObserver implements LodestarObserver {
  constructor(
    private readonly modules: {
      logger: Logger;
      forkChoice: IForkChoice;
      regen: IStateRegenerator;
      metrics: Metrics | null;
    },
  ) {
  }

  subscribe(emitter: ChainEventEmitter): void {
    emitter.on(ChainEvent.checkpoint, this.onCheckpoint.bind(this));
  }

  unsubscribe(emitter: ChainEventEmitter): void {
    emitter.off(ChainEvent.checkpoint, this.onCheckpoint);
  }

  private async onCheckpoint(_checkpoint: Checkpoint, _state: CachedBeaconStateAllForks): Promise<void> {
    const headStateRoot = this.modules.forkChoice.getHead().stateRoot;
    this.modules.regen.pruneOnCheckpoint(
      this.modules.forkChoice.getFinalizedCheckpoint().epoch,
      this.modules.forkChoice.getJustifiedCheckpoint().epoch,
      headStateRoot
    );
  }
}