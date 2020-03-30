import {computeEpochAtSlot, isActiveValidator} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconState, SignedBeaconBlock, Validator} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../../metrics";
import {ChainEventEmitter} from "../interface";

export function postProcess(
  config: IBeaconConfig, db: IBeaconDb, logger: ILogger, metrics: IBeaconMetrics, eventBus: ChainEventEmitter
): (source: AsyncIterable<{preState: BeaconState; postState: BeaconState; block: SignedBeaconBlock}>) => void {
  return (source) => {
    (async function() {
      for await(const item of source) {
        metrics.currentSlot.set(item.block.message.slot);
        const preSlot = item.preState.slot;
        const preFinalizedEpoch = item.preState.finalizedCheckpoint.epoch;
        const preJustifiedEpoch = item.preState.currentJustifiedCheckpoint.epoch;
        const currentEpoch = computeEpochAtSlot(config, item.postState.slot);
        if (computeEpochAtSlot(config, preSlot) < currentEpoch) {
          const blockRoot = config.types.BeaconBlock.hashTreeRoot(item.block.message);
          eventBus.emit("processedCheckpoint", {epoch: currentEpoch, root: blockRoot});
          // Update FFG Checkpoints
          // Newly justified epoch
          if (preJustifiedEpoch < item.postState.currentJustifiedCheckpoint.epoch) {
            const justifiedBlockRoot = item.postState.currentJustifiedCheckpoint.root;
            const justifiedBlock = await db.block.get(justifiedBlockRoot.valueOf() as Uint8Array);
            logger.important(`Epoch ${computeEpochAtSlot(config, justifiedBlock.message.slot)} is justified!`);
            await Promise.all([
              db.chain.setJustifiedStateRoot(justifiedBlock.message.stateRoot.valueOf() as Uint8Array),
              db.chain.setJustifiedBlockRoot(justifiedBlockRoot.valueOf() as Uint8Array),
            ]);
            eventBus.emit("justifiedCheckpoint", item.postState.currentJustifiedCheckpoint);
          }
          // Newly finalized epoch
          if (preFinalizedEpoch < item.postState.finalizedCheckpoint.epoch) {
            const finalizedBlockRoot = item.postState.finalizedCheckpoint.root;
            const finalizedBlock = await db.block.get(finalizedBlockRoot.valueOf() as Uint8Array);
            logger.important(`Epoch ${computeEpochAtSlot(config, finalizedBlock.message.slot)} is finalized!`);
            await Promise.all([
              db.chain.setFinalizedStateRoot(finalizedBlock.message.stateRoot.valueOf() as Uint8Array),
              db.chain.setFinalizedBlockRoot(finalizedBlockRoot.valueOf() as Uint8Array),
            ]);
            eventBus.emit("finalizedCheckpoint", item.postState.finalizedCheckpoint);
          }
          metrics.previousJustifiedEpoch.set(item.postState.previousJustifiedCheckpoint.epoch);
          metrics.currentJustifiedEpoch.set(item.postState.currentJustifiedCheckpoint.epoch);
          metrics.currentFinalizedEpoch.set(item.postState.finalizedCheckpoint.epoch);
          metrics.currentEpochLiveValidators.set(
            Array.from(item.postState.validators).filter((v: Validator) => isActiveValidator(v, currentEpoch)).length
          );
        }
      }
    })();
  };
}