import {routes} from "@lodestar/api";
import {EpochDifference, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {BeaconChain} from "../chain.js";

export function emitHeadV2(this: BeaconChain, head: ProtoBlock, headChanged: boolean) {
  if (
    headChanged ||
    !this.headV2PayloadStatusCache.has(head.blockRoot) ||
    (this.headV2PayloadStatusCache.get(head.blockRoot)?.status !== PayloadStatus.FULL &&
      head.payloadStatus === PayloadStatus.FULL)
  ) {
    this.emitter.emit(routes.events.EventType.headV2, {
      version: this.config.getForkName(head.slot),
      data: {
        slot: head.slot,
        block: head.blockRoot,
        state: head.stateRoot,
        payloadStatus: toApiPayloadStatus(head.payloadStatus),
        epochTransition: computeStartSlotAtEpoch(computeEpochAtSlot(head.slot)) === head.slot,
        currentEpochDependentRoot: this.forkChoice.getDependentRoot(head, EpochDifference.previous),
        nextEpochDependentRoot: this.forkChoice.getDependentRoot(head, EpochDifference.current),
        executionOptimistic: isOptimisticBlock(head),
      },
    });
    this.headV2PayloadStatusCache.set(head.blockRoot, {status: head.payloadStatus, slot: head.slot});
    this.metrics?.headV2PayloadStatusCacheSize.set(this.headV2PayloadStatusCache.size);
  }
}

function toApiPayloadStatus(status?: PayloadStatus): "empty" | "full" {
  switch (status) {
    case PayloadStatus.FULL:
      return "full";
    default:
      return "empty";
  }
}
