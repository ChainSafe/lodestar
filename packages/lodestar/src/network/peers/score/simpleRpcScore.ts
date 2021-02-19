import {RpcScoreEvent, IRpcScoreTracker} from "./interface";
import {IPeerMetadataStore} from "../metastore";
import PeerId from "peer-id";

const scoreConstants: Record<RpcScoreEvent, number> = {
  [RpcScoreEvent.NONE]: 0,
  [RpcScoreEvent.SUCCESS_BLOCK_RANGE]: 10,
  [RpcScoreEvent.SUCCESS_BLOCK_ROOT]: 5,
  [RpcScoreEvent.RESPONSE_TIMEOUT]: -20,
  [RpcScoreEvent.UNSUPPORTED_PROTOCOL]: -100,
  [RpcScoreEvent.MISSING_BLOCKS]: -15,
  [RpcScoreEvent.UNKNOWN_ERROR]: -10,
};

export const DEFAULT_RPC_SCORE = 100;
const MAX_SCORE = 200;
const MIN_SCORE = 0;

export class SimpleRpcScoreTracker implements IRpcScoreTracker {
  private readonly store: IPeerMetadataStore;

  constructor(store: IPeerMetadataStore) {
    this.store = store;
  }

  public getScore(peer: PeerId): number {
    return this.store.rpcScore.get(peer) ?? DEFAULT_RPC_SCORE;
  }

  public reset(peer: PeerId): void {
    this.store.rpcScore.set(peer, DEFAULT_RPC_SCORE);
  }

  public update(peer: PeerId, event: RpcScoreEvent): void {
    const currentScore = this.getScore(peer);
    const delta = scoreConstants[event];
    // ensure score is between min and max
    this.store.rpcScore.set(peer, Math.max(Math.min(MAX_SCORE, currentScore + delta), MIN_SCORE));
  }
}
