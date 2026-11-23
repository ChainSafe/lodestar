import {BeaconConfig} from "@lodestar/config";
import {ForkChoice} from "@lodestar/native/fork-choice";
import {
  BlockStateCache,
  CheckpointStateCache,
  SeenBlock,
  StateRegenerator as StateRegeneratorBinding,
} from "@lodestar/native/regen";
import {IBeaconStateViewNative, NativeBeaconStateView} from "@lodestar/state-transition";

export class NativeRegenerator {
  private readonly binding: StateRegeneratorBinding;

  constructor(
    private readonly config: BeaconConfig,
    blockStateCache: BlockStateCache,
    checkpointStateCache: CheckpointStateCache,
    seenBlock: SeenBlock,
    forkChoice: ForkChoice
  ) {
    this.binding = new StateRegeneratorBinding(blockStateCache, checkpointStateCache, seenBlock, forkChoice);
  }

  getState(root: Uint8Array, allowDiskReload: boolean): NativeBeaconStateView {
    return new NativeBeaconStateView(
      this.config,
      this.binding.getState(root, allowDiskReload) as IBeaconStateViewNative
    );
  }

  release(): void {
    this.binding.release();
  }
}
