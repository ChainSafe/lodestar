import PeerId from "peer-id";

export enum RpcScoreEvent {
  //on successful block range fetch
  SUCCESS_BLOCK_RANGE,
  //on successful block by root fetch
  SUCCESS_BLOCK_ROOT,
  //peer returned block by range response but was missing blocks
  MISSING_BLOCKS,
  RESPONSE_TIMEOUT,
  UNSUPPORTED_PROTOCOL,
  UNKNOWN_ERROR,
}

export interface IRpcScoreTracker {
  getScore(peer: PeerId): number;
  update(peer: PeerId, event: RpcScoreEvent): void;
  reset(peer: PeerId): void;
}
