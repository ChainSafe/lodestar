import {TreeBacked, toHexString} from "@chainsafe/ssz";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IBeaconDb} from "../../db/api";
import {IBeaconMetrics} from "../../metrics";
import {IAttestationProcessor} from "../interface";
import {ChainEventEmitter} from "../emitter";
import {ILMDGHOST} from "../forkChoice";
import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";

export function postProcess(
  config: IBeaconConfig,
  logger: ILogger,
  db: IBeaconDb,
  forkChoice: ILMDGHOST,
  metrics: IBeaconMetrics,
  eventBus: ChainEventEmitter,
  attestationProcessor: IAttestationProcessor
): (
  source: AsyncIterable<{
    preStateContext: ITreeStateContext;
    postStateContext: ITreeStateContext;
    block: SignedBeaconBlock;
    finalized: boolean;
  }>
) => Promise<void> {
  return async (source) => {
    return (async function () {
      for await (const {block, preStateContext, postStateContext, finalized} of source) {
        await db.processBlockOperations(block);
        if (!finalized) {
          await attestationProcessor.receiveBlock(block);
        }
        metrics.currentSlot.set(block.message.slot);
        eventBus.emit("block", block);
        const preSlot = preStateContext.state.slot;
        const preFinalizedEpoch = preStateContext.state.finalizedCheckpoint.epoch;
        const preJustifiedEpoch = preStateContext.state.currentJustifiedCheckpoint.epoch;
        const currentEpoch = computeEpochAtSlot(config, postStateContext.state.slot);
        if (computeEpochAtSlot(config, preSlot) < currentEpoch) {
          eventBus.emit("checkpoint", {
            epoch: currentEpoch,
            root: config.types.BeaconBlock.hashTreeRoot(block.message),
          });
          await db.checkpointStateCache.add(postStateContext);
          // newly justified epoch
          if (preJustifiedEpoch < postStateContext.state.currentJustifiedCheckpoint.epoch) {
            newJustifiedEpoch(logger, metrics, eventBus, postStateContext.state);
          }
          // newly finalized epoch
          if (preFinalizedEpoch < postStateContext.state.finalizedCheckpoint.epoch) {
            newFinalizedEpoch(logger, metrics, eventBus, postStateContext.state);
          }
          metrics.currentEpochLiveValidators.set(postStateContext.epochCtx.currentShuffling.activeIndices.length);
        } else {
          await db.checkpointStateCache.addStateRoot(
            postStateContext.state.hashTreeRoot(),
            preStateContext.state.hashTreeRoot()
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
  state: TreeBacked<BeaconState>
): void {
  logger.important(`Epoch ${state.currentJustifiedCheckpoint.epoch} is justified at root \
    ${toHexString(state.currentJustifiedCheckpoint.root)}!`);
  metrics.previousJustifiedEpoch.set(state.previousJustifiedCheckpoint.epoch);
  metrics.currentJustifiedEpoch.set(state.currentJustifiedCheckpoint.epoch);
  eventBus.emit("justified", state.currentJustifiedCheckpoint);
}

function newFinalizedEpoch(
  logger: ILogger,
  metrics: IBeaconMetrics,
  eventBus: ChainEventEmitter,
  state: TreeBacked<BeaconState>
): void {
  logger.important(`Epoch ${state.finalizedCheckpoint.epoch} is finalized at root \
    ${toHexString(state.finalizedCheckpoint.root)}!`);
  metrics.currentFinalizedEpoch.set(state.finalizedCheckpoint.epoch);
  eventBus.emit("finalized", state.finalizedCheckpoint);
}
