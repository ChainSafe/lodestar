import {BlockProviderScoreEvent, IBlockProviderScoreTracker} from "./interface";
import {IPeerMetadataStore} from "../interface";
import PeerId from "peer-id";

const scoreConstants: Record<BlockProviderScoreEvent, number> = {
  [BlockProviderScoreEvent.SUCCESS_BLOCK_RANGE]: 10,
  [BlockProviderScoreEvent.SUCCESS_BLOCK_ROOT]: 5,
  [BlockProviderScoreEvent.RESPONSE_TIMEOUT]: -20,
  [BlockProviderScoreEvent.UNSUPPORTED_PROTOCOL]: -100,
  [BlockProviderScoreEvent.MISSING_BLOCKS]: -15,
  [BlockProviderScoreEvent.UNKNOWN_ERROR]: -10,
};

const DEFAULT_SCORE = 100;
const MAX_SCORE = 200;
const MIN_SCORE = 0;

export class SimpleBlockProviderScoreTracker implements IBlockProviderScoreTracker {
  private readonly store: IPeerMetadataStore;

  constructor(store: IPeerMetadataStore) {
    this.store = store;
  }

  public getScore(peer: PeerId): number {
    return this.store.getBlockProviderScore(peer) ?? DEFAULT_SCORE;
  }

  public reset(peer: PeerId): void {
    this.store.setBlockProviderScore(peer, DEFAULT_SCORE);
  }

  public update(peer: PeerId, event: BlockProviderScoreEvent): void {
    const currentScore = this.getScore(peer);
    const delta = scoreConstants[event];
    this.store.setBlockProviderScore(peer, Math.max(Math.min(MAX_SCORE, currentScore + delta), MIN_SCORE));
  }
}
