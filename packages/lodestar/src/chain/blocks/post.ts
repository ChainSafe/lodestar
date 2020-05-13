import {computeEpochAtSlot, isActiveValidator} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconState, SignedBeaconBlock, Validator} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../../metrics";
import {ChainEventEmitter, IAttestationProcessor} from "../interface";
import {ILMDGHOST} from "../forkChoice";

export function postProcess(
  config: IBeaconConfig,
  logger: ILogger,
  db: IBeaconDb,
  forkChoice: ILMDGHOST,
  metrics: IBeaconMetrics,
  eventBus: ChainEventEmitter,
  attestationProcessor: IAttestationProcessor
): (source: AsyncIterable<{preState: BeaconState; postState: BeaconState; block: SignedBeaconBlock}>) => Promise<void> {
  return async (source) => {
    return (async function() {
      for await(const {block, preState, postState} of source) {
        await db.processBlockOperations(block);
        await attestationProcessor.receiveBlock(block);
        metrics.currentSlot.set(block.message.slot);
        eventBus.emit("processedBlock", block);
        const preSlot = preState.slot;
        const preFinalizedEpoch = preState.finalizedCheckpoint.epoch;
        const preJustifiedEpoch = preState.currentJustifiedCheckpoint.epoch;
        const currentEpoch = computeEpochAtSlot(config, postState.slot);
        if (computeEpochAtSlot(config, preSlot) < currentEpoch) {
          eventBus.emit(
            "processedCheckpoint",
            {epoch: currentEpoch, root: forkChoice.getBlockSummaryAtSlot(preSlot).blockRoot},
          );
          // newly justified epoch
          if (preJustifiedEpoch < postState.currentJustifiedCheckpoint.epoch) {
            newJustifiedEpoch(logger, metrics, eventBus, postState);
          }
          // newly finalized epoch
          if (preFinalizedEpoch < postState.finalizedCheckpoint.epoch) {
            newFinalizedEpoch(logger, metrics, eventBus, postState);
          }
          metrics.currentEpochLiveValidators.set(
            Array.from(postState.validators).filter((v: Validator) => isActiveValidator(v, currentEpoch)).length
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
