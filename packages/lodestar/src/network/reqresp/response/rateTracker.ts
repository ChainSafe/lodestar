import {ILogger} from "@chainsafe/lodestar-utils";
import PeerId from "peer-id";
import {MapDef} from "../../../util/map";
import {IPeerRpcScoreStore, PeerAction} from "../../peers/score";

interface IRateTrackerModules {
  logger: ILogger;
  peerRpcScores: IPeerRpcScoreStore;
}

export interface IReqRespRateTracker {
  requestBlocksForPeerId(peerId: PeerId, blockCount: number): number;
}

export type RateTrackerOpts = {
  requestCountTotalLimit: number;
  requestCountPeerLimit: number;
  blockCountTotalLimit: number;
  blockCountPeerLimit: number;
  rateTrackerTimeoutMs: number;
};

/**
 * The rate tracker allows up to `limit` objects in a period.
 */
export class RateTracker {
  private requestsWithinWindow = 0;
  private requests = new MapDef<number, number>(() => 0);

  constructor(private limit: number, private timeoutMs: number) {}

  requestObjects(objectCount: number): number {
    if (objectCount <= 0) throw Error("Invalid objectCount " + objectCount);
    this.prune();
    if (this.requestsWithinWindow >= this.limit) {
      return 0;
    }

    this.requestsWithinWindow += objectCount;
    const now = Date.now();
    const curObjectCount = this.requests.getOrDefault(now);
    this.requests.set(now, curObjectCount + objectCount);

    return objectCount;
  }

  getRequestedObjectsWithinWindow(): number {
    return this.requestsWithinWindow;
  }

  private prune(): void {
    const now = Date.now();

    for (const [time, count] of this.requests.entries()) {
      // reclaim the quota for old requests
      if (now - time >= this.timeoutMs) {
        this.requestsWithinWindow -= count;
        this.requests.delete(time);
      }
    }

    if (this.requestsWithinWindow < 0) {
      this.requestsWithinWindow = 0;
    }
  }
}

// TODO: unit tests
/**
 * The rate tracker for all peers.
 */
export class ReqRespRateTracker implements IReqRespRateTracker {
  private readonly logger: ILogger;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private requestCountTotalTracker: RateTracker;
  private requestCountTrackersByPeer: MapDef<string, RateTracker>;
  private blockCountTotalTracker: RateTracker;
  private blockCountTrackersByPeer: MapDef<string, RateTracker>;

  constructor(opts: RateTrackerOpts, modules: IRateTrackerModules) {
    this.requestCountTotalTracker = new RateTracker(opts.requestCountTotalLimit, opts.rateTrackerTimeoutMs);
    this.requestCountTrackersByPeer = new MapDef(
      () => new RateTracker(opts.requestCountPeerLimit, opts.rateTrackerTimeoutMs)
    );
    this.blockCountTotalTracker = new RateTracker(opts.blockCountTotalLimit, opts.rateTrackerTimeoutMs);
    this.blockCountTrackersByPeer = new MapDef(
      () => new RateTracker(opts.blockCountPeerLimit, opts.rateTrackerTimeoutMs)
    );
    this.logger = modules.logger;
    this.peerRpcScores = modules.peerRpcScores;
  }

  requestBlocksForPeerId(peerId: PeerId, blockCount: number): number {
    const peerIdStr = peerId.toB58String();
    const requestCountPeerTracker = this.requestCountTrackersByPeer.getOrDefault(peerIdStr);
    const blockCountPeerTracker = this.blockCountTrackersByPeer.getOrDefault(peerIdStr);

    for (const {tracker, count, applyPenalty, name} of [
      {tracker: this.requestCountTotalTracker, count: 1, applyPenalty: false, name: "requestCountTotalTracker"},
      {tracker: requestCountPeerTracker, count: 1, applyPenalty: true, name: "requestCountPeerTracker"},
      {tracker: this.blockCountTotalTracker, count: blockCount, applyPenalty: false, name: "blockCountTotalTracker"},
      {tracker: blockCountPeerTracker, count: blockCount, applyPenalty: true, name: "blockCountPeerTracker"},
    ]) {
      if (tracker.requestObjects(count) === 0) {
        this.logger.warn("Do not serve request due to rate limit", {
          peerId: peerIdStr,
          blockCount,
          rateTracker: name,
          requestsWithinWindow: tracker.getRequestedObjectsWithinWindow(),
        });
        if (applyPenalty) {
          this.peerRpcScores.applyAction(peerId, PeerAction.Fatal, "RateLimit");
        }
        return 0;
      }
    }

    return blockCount;
  }
}
