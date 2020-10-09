import {Checkpoint} from "@chainsafe/lodestar-types";
import {BeaconChain} from "..";
import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";

export async function handleJustifiedCheckpoint(
  this: BeaconChain,
  cp: Checkpoint,
  stateContext: ITreeStateContext
): Promise<void> {
  this.logger.important("Checkpoint justified", this.config.types.Checkpoint.toJson(cp));
  this.metrics.previousJustifiedEpoch.set(stateContext.state.previousJustifiedCheckpoint.epoch);
  this.metrics.currentJustifiedEpoch.set(cp.epoch);
}

export async function handleFinalizedCheckpoint(this: BeaconChain, cp: Checkpoint): Promise<void> {
  this.logger.important("Checkpoint finalized", this.config.types.Checkpoint.toJson(cp));
  this.metrics.currentFinalizedEpoch.set(cp.epoch);
}

export async function handleCheckpoint(
  this: BeaconChain,
  cp: Checkpoint,
  stateContext: ITreeStateContext
): Promise<void> {
  this.logger.verbose("Checkpoint processed", this.config.types.Checkpoint.toJson(cp));
  await this.db.checkpointStateCache.add(cp, stateContext);
  this.metrics.currentEpochLiveValidators.set(stateContext.epochCtx.currentShuffling.activeIndices.length);
  const parentBlockSummary = await this.forkChoice.getBlock(stateContext.state.latestBlockHeader.parentRoot);
  if (parentBlockSummary) {
    const justifiedCheckpoint = stateContext.state.currentJustifiedCheckpoint;
    const justifiedEpoch = justifiedCheckpoint.epoch;
    const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
    if (justifiedEpoch > preJustifiedEpoch) {
      this.emitter.emit("justified", justifiedCheckpoint, stateContext);
    }
    const finalizedCheckpoint = stateContext.state.finalizedCheckpoint;
    const finalizedEpoch = finalizedCheckpoint.epoch;
    const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
    if (finalizedEpoch > preFinalizedEpoch) {
      this.emitter.emit("finalized", finalizedCheckpoint, stateContext);
    }
  }
}
