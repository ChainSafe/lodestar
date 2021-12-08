import {ILogger} from "@chainsafe/lodestar-utils";
import PeerId from "peer-id";
import {MapDef} from "../../../util/map";
import {IPeerRpcScoreStore, PeerAction} from "../../peers/score";
import {IRateLimiter} from "../interface";
import {RateTracker} from "../rateTracker";
import {Method, RequestTypedContainer} from "../types";

interface IRateLimiterModules {
  logger: ILogger;
  peerRpcScores: IPeerRpcScoreStore;
}

/**
 * Options:
 * - requestCountPeerLimit: maximum request count we can serve per peer within rateTrackerTimeoutMs
 * - blockCountPeerLimit: maximum block count we can serve per peer within rateTrackerTimeoutMs
 * - blockCountTotalLimit: maximum block count we can serve for all peers within rateTrackerTimeoutMs
 * - rateTrackerTimeoutMs: the time period we want to track total requests or objects, normally 1 min
 */
export type RateLimiterOpts = {
  requestCountPeerLimit: number;
  blockCountPeerLimit: number;
  blockCountTotalLimit: number;
  rateTrackerTimeoutMs: number;
};

/**
 * Default value for RateLimiterOpts
 * - requestCountPeerLimit: allow to serve 50 requests per peer within 1 minute
 * - blockCountPeerLimit: allow to serve 500 blocks per peer within 1 minute
 * - blockCountTotalLimit: allow to serve 2000 (blocks) for all peer within 1 minute (4 x blockCountPeerLimit)
 * - rateTrackerTimeoutMs: 1 minute
 */
export const defaultRateLimiterOpts = {
  requestCountPeerLimit: 50,
  blockCountPeerLimit: 500,
  blockCountTotalLimit: 2000,
  rateTrackerTimeoutMs: 60 * 1000,
};

/**
 * This class is singleton, it has per-peer request count rate tracker and block count rate tracker
 * and a block count rate tracker for all peers (this is lodestar specific).
 */
export class InboundRateLimiter implements IRateLimiter {
  private readonly logger: ILogger;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private requestCountTrackersByPeer: MapDef<string, RateTracker>;
  /**
   * This rate tracker is specific to lodestar, we don't want to serve too many blocks for peers at the
   * same time, even through we limit block count per peer as in blockCountTrackersByPeer
   */
  private blockCountTotalTracker: RateTracker;
  private blockCountTrackersByPeer: MapDef<string, RateTracker>;

  constructor(opts: RateLimiterOpts, modules: IRateLimiterModules) {
    this.requestCountTrackersByPeer = new MapDef(
      () => new RateTracker({limit: opts.requestCountPeerLimit, timeoutMs: opts.rateTrackerTimeoutMs})
    );
    this.blockCountTotalTracker = new RateTracker({
      limit: opts.blockCountTotalLimit,
      timeoutMs: opts.rateTrackerTimeoutMs,
    });
    this.blockCountTrackersByPeer = new MapDef(
      () => new RateTracker({limit: opts.blockCountPeerLimit, timeoutMs: opts.rateTrackerTimeoutMs})
    );
    this.logger = modules.logger;
    this.peerRpcScores = modules.peerRpcScores;
  }

  /**
   * Tracks a request from a peer and returns whether to allow the request based on the configured rate limit params.
   */
  allowRequest(peerId: PeerId, requestTyped: RequestTypedContainer): boolean {
    const peerIdStr = peerId.toB58String();

    // rate limit check for request
    const requestCountPeerTracker = this.requestCountTrackersByPeer.getOrDefault(peerIdStr);
    if (requestCountPeerTracker.requestObjects(1) === 0) {
      this.logger.verbose("Do not serve request due to request count rate limit", {
        peerId: peerIdStr,
        requestsWithinWindow: requestCountPeerTracker.getRequestedObjectsWithinWindow(),
      });
      this.peerRpcScores.applyAction(peerId, PeerAction.Fatal, "RateLimit");
      return false;
    }

    let numBlock = 0;
    switch (requestTyped.method) {
      case Method.BeaconBlocksByRange:
        numBlock = requestTyped.body.count;
        break;
      case Method.BeaconBlocksByRoot:
        numBlock = requestTyped.body.length;
        break;
    }

    // rate limit check for block count
    if (numBlock > 0) {
      const blockCountPeerTracker = this.blockCountTrackersByPeer.getOrDefault(peerIdStr);
      if (blockCountPeerTracker.requestObjects(numBlock) === 0) {
        this.logger.verbose("Do not serve block request due to block count rate limit", {
          peerId: peerIdStr,
          blockCount: numBlock,
          requestsWithinWindow: blockCountPeerTracker.getRequestedObjectsWithinWindow(),
        });
        this.peerRpcScores.applyAction(peerId, PeerAction.Fatal, "RateLimit");
        return false;
      }

      if (this.blockCountTotalTracker.requestObjects(numBlock) === 0) {
        // don't apply penalty
        return false;
      }
    }

    return true;
  }

  prune(peerId: PeerId): void {
    const peerIdStr = peerId.toB58String();
    this.requestCountTrackersByPeer.delete(peerIdStr);
    this.blockCountTrackersByPeer.delete(peerIdStr);
  }
}
