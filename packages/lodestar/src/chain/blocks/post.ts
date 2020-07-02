import {computeEpochAtSlot, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../../metrics";
import {ChainEventEmitter, IAttestationProcessor} from "../interface";
import {ILMDGHOST} from "../forkChoice";
import {IStateContext} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

export function postProcess(
  config: IBeaconConfig,
  logger: ILogger,
  db: IBeaconDb,
  epochCtx: EpochContext,
  forkChoice: ILMDGHOST,
  metrics: IBeaconMetrics,
  eventBus: ChainEventEmitter,
  attestationProcessor: IAttestationProcessor
): (source: AsyncIterable<{
    preState: IStateContext; postState: IStateContext; block: SignedBeaconBlock; finalized: boolean;
  }>) => Promise<void> {
  return async (source) => {
    return (async function() {
      for await(const {block, preState, postState, finalized} of source) {
        await db.processBlockOperations(block);
        if(!finalized) {
          await attestationProcessor.receiveBlock(block);
        }
        metrics.currentSlot.set(block.message.slot);
        eventBus.emit("processedBlock", block);
        const preSlot = preState.state.slot;
        const preFinalizedEpoch = preState.state.finalizedCheckpoint.epoch;
        const preJustifiedEpoch = preState.state.currentJustifiedCheckpoint.epoch;
        const currentEpoch = computeEpochAtSlot(config, preState.state.slot);
        if (computeEpochAtSlot(config, preSlot) < currentEpoch) {
          eventBus.emit(
            "processedCheckpoint",
            {epoch: currentEpoch, root: forkChoice.getBlockSummaryAtSlot(preSlot).blockRoot},
          );
          // newly justified epoch
          if (preJustifiedEpoch < postState.state.currentJustifiedCheckpoint.epoch) {
            newJustifiedEpoch(logger, metrics, eventBus, postState.state);
          }
          // newly finalized epoch
          if (preFinalizedEpoch < postState.state.finalizedCheckpoint.epoch) {
            newFinalizedEpoch(logger, metrics, eventBus, postState.state);
          }
          metrics.currentEpochLiveValidators.set(
            epochCtx.currentShuffling.activeIndices.length
          );
        }
      }
      return;
    })();
  };
}

function newJustifiedEpoch(
  logger: ILogger,
  metrics: IBeaconMetrics,
  eventBus: ChainEventEmitter,
  state: BeaconState
): void {
  logger.important(`Epoch ${state.currentJustifiedCheckpoint.epoch} is justified!`);
  metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
  metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
  eventBus.emit("justifiedCheckpoint", state.currentJustifiedCheckpoint);
}

function newFinalizedEpoch(
  logger: ILogger,
  metrics: IBeaconMetrics,
  eventBus: ChainEventEmitter,
  state: BeaconState
): void {
  logger.important(`Epoch ${state.finalizedCheckpoint.epoch} is finalized!`);
  metrics.currentFinalizedEpoch.set(state.finalizedCheckpoint.epoch);
  eventBus.emit("finalizedCheckpoint", state.finalizedCheckpoint);
}
