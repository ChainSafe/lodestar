import {ILogger} from "@chainsafe/lodestar-utils";
import PeerId from "peer-id";
import {MapDef} from "../../../util/map";
import {IPeerRpcScoreStore, PeerAction} from "../../peers/score";
import {IReqRespRateLimiter} from "../interface";
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
export class ResponseRateLimiter implements IReqRespRateLimiter {
  private readonly logger: ILogger;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private requestCountTotalTracker: RateTracker;
  private requestCountTrackersByPeer: MapDef<string, RateTracker>;
  private blockCountTotalTracker: RateTracker;
  private blockCountTrackersByPeer: MapDef<string, RateTracker>;

  constructor(opts: RateLimiterOpts, modules: IRateLimiterModules) {
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

  /**
   * Allow to process requests from peer or not based on the rate limit params configured.
   * @param numBlock only apply for beacon_blocks_by_range and beacon_blocks_by_root
   */
  allowToProcess(peerId: PeerId, numBlock?: number): boolean {
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
}
