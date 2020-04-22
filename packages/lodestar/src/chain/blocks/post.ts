import {computeEpochAtSlot, isActiveValidator} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconState, SignedBeaconBlock, Validator} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../db/api";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../../metrics";
import {ChainEventEmitter, IAttestationProcessor} from "../interface";
import {Epoch} from "@chainsafe/lodestar-types/lib";
import {OpPool} from "../../opPool";

export function postProcess(
  config: IBeaconConfig, db: IBeaconDb, logger: ILogger, metrics: IBeaconMetrics, eventBus: ChainEventEmitter,
  opPool: OpPool, attestationProcessor: IAttestationProcessor
): (source: AsyncIterable<{preState: BeaconState; postState: BeaconState; block: SignedBeaconBlock}>) => Promise<void> {
  return async (source) => {
    return (async function() {
      for await(const item of source) {
        await opPool.processBlockOperations(item.block);
        await attestationProcessor.receiveBlock(item.block);
        metrics.currentSlot.set(item.block.message.slot);
        eventBus.emit("processedBlock", item.block);
        const preSlot = item.preState.slot;
        const preFinalizedEpoch = item.preState.finalizedCheckpoint.epoch;
        const preJustifiedEpoch = item.preState.currentJustifiedCheckpoint.epoch;
        const currentEpoch = computeEpochAtSlot(config, item.postState.slot);
        if (computeEpochAtSlot(config, preSlot) < currentEpoch) {
          eventBus.emit("processedCheckpoint", {epoch: currentEpoch, root: await db.chain.getBlockRoot(preSlot)});
          await Promise.all([
            setJustified(config, db, eventBus, logger, metrics, item.postState, preJustifiedEpoch),
            setFinalized(config, db, eventBus, logger, metrics, item.postState, preFinalizedEpoch)
          ]);

          metrics.currentEpochLiveValidators.set(
            Array.from(item.postState.validators).filter((v: Validator) => isActiveValidator(v, currentEpoch)).length
          );
        }
      }
      return;
    })();
  };
}

async function setJustified(
  config: IBeaconConfig, db: IBeaconDb, eventBus: ChainEventEmitter, logger: ILogger, metrics: IBeaconMetrics,
  postState: BeaconState, preJustifiedEpoch: Epoch
): Promise<void> {
  // Newly justified epoch
  if (preJustifiedEpoch < postState.currentJustifiedCheckpoint.epoch) {
    const justifiedBlockRoot = postState.currentJustifiedCheckpoint.root;
    const justifiedBlock = await db.block.get(justifiedBlockRoot.valueOf() as Uint8Array);
    logger.important(`Epoch ${postState.currentJustifiedCheckpoint.epoch} is justified!`);
    await Promise.all([
      db.chain.setJustifiedStateRoot(justifiedBlock.message.stateRoot.valueOf() as Uint8Array),
      db.chain.setJustifiedBlockRoot(justifiedBlockRoot.valueOf() as Uint8Array),
    ]);
    metrics.previousJustifiedEpoch.set(preJustifiedEpoch);
    metrics.currentJustifiedEpoch.set(postState.currentJustifiedCheckpoint.epoch);
    eventBus.emit("justifiedCheckpoint", postState.currentJustifiedCheckpoint);
  }
}

async function setFinalized(
  config: IBeaconConfig, db: IBeaconDb, eventBus: ChainEventEmitter, logger: ILogger, metrics: IBeaconMetrics,
  postState: BeaconState, preFinalizedEpoch: Epoch
): Promise<void> {
  // Newly finalized epoch
  if (preFinalizedEpoch < postState.finalizedCheckpoint.epoch) {
    const finalizedBlockRoot = postState.finalizedCheckpoint.root;
    const finalizedBlock = await db.block.get(finalizedBlockRoot.valueOf() as Uint8Array);
    logger.important(`Epoch ${postState.finalizedCheckpoint.epoch} is finalized!`);
    await Promise.all([
      db.chain.setFinalizedStateRoot(finalizedBlock.message.stateRoot.valueOf() as Uint8Array),
      db.chain.setFinalizedBlockRoot(finalizedBlockRoot.valueOf() as Uint8Array),
    ]);
    metrics.currentFinalizedEpoch.set(postState.finalizedCheckpoint.epoch);
    eventBus.emit("finalizedCheckpoint", postState.finalizedCheckpoint);
  }
}