import {ILogger} from "@chainsafe/lodestar-utils";
import PeerId from "peer-id";
import {MapDef} from "../../../util/map";
import {IPeerRpcScoreStore, PeerAction} from "../../peers/score";
import {IRateLimiter} from "../interface";
import {RateTracker} from "../rateTracker";

interface IRateLimiterModules {
  logger: ILogger;
  peerRpcScores: IPeerRpcScoreStore;
}

export type RateLimiterOpts = {
  requestCountTotalLimit: number;
  requestCountPeerLimit: number;
  blockCountTotalLimit: number;
  blockCountPeerLimit: number;
  rateTrackerTimeoutMs: number;
};

/**
 * The rate tracker for all peers.
 */
export class InboundRateLimiter implements IRateLimiter {
  private readonly logger: ILogger;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private requestCountTotalTracker: RateTracker;
  private requestCountTrackersByPeer: MapDef<string, RateTracker>;
  private blockCountTotalTracker: RateTracker;
  private blockCountTrackersByPeer: MapDef<string, RateTracker>;

  constructor(opts: RateLimiterOpts, modules: IRateLimiterModules) {
    this.requestCountTotalTracker = new RateTracker({
      limit: opts.requestCountTotalLimit,
      timeoutMs: opts.rateTrackerTimeoutMs,
    });
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
   * @param numBlock only applies to beacon_blocks_by_range and beacon_blocks_by_root
   */
  allowRequest(peerId: PeerId, numBlock?: number): boolean {
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

    if (this.requestCountTotalTracker.requestObjects(1) === 0) {
      return false;
    }

    // rate limit check for block count
    if (numBlock !== undefined) {
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
