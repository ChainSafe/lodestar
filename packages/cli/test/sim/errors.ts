import {Slot, Epoch, RootHex} from "@lodestar/types";

export type NodeId = number;
export type HeadSummary = {slot: Slot; block: RootHex};

export enum ErrorCode {
  missedSlot = "missed_slot",
  inclusionScore = "inclusion_score",
  lowSyncParticipation = "low_sync_participation",
  lowEpochParticipation = "low_epoch_participation",
  notSameHead = "not_same_head",
  lowPeerCount = "low_peer_count",
}

export type ErrorType =
  | {code: ErrorCode.missedSlot; slot: Slot}
  | {code: ErrorCode.inclusionScore; slot: Slot; attnIncScore: number}
  | {code: ErrorCode.lowSyncParticipation; slot: Slot; syncP: number; minSyncP: number}
  | {code: ErrorCode.lowEpochParticipation; stateSlot: Slot; epoch: Epoch; flag: string; participation: number}
  | {code: ErrorCode.notSameHead; time: string; nodeA: NodeId; headA: HeadSummary; nodeB: NodeId; headB: HeadSummary}
  | {code: ErrorCode.lowPeerCount; slot: Slot; node: NodeId; peerCount: number; minPeerCount: number};

export function renderError(error: ErrorType): string {
  switch (error.code) {
    case ErrorCode.missedSlot:
      return `Missed slot ${error.slot}`;

    case ErrorCode.inclusionScore:
      return `Attestations in block slot ${error.slot} have sum inclusion score ${error.attnIncScore}`;

    case ErrorCode.lowSyncParticipation:
      return `Low sync participation ${error.syncP} < ${error.minSyncP} at slot ${error.slot}`;

    case ErrorCode.lowEpochParticipation:
      return `Low ${error.flag} epoch participation ${error.participation} in state.slot ${error.stateSlot} for epoch ${error.epoch}`;

    case ErrorCode.notSameHead:
      return (
        `Different heads at ${error.time} ` +
        `node[${error.nodeA}] ${renderHead(error.headA)} ` +
        `node[${error.nodeB}] ${renderHead(error.headB)}`
      );

    case ErrorCode.lowPeerCount:
      return `Low peer count ${error.peerCount} < ${error.minPeerCount} node ${error.node} at slot ${error.slot}`;
  }
}

function renderHead(head: HeadSummary): string {
  return `${head.slot}/${head.block.slice(0, 6)}`;
}
