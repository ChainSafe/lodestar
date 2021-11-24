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
    const requestCountPeerTracker = this.requestCountTrackersByPeer.getOrDefault(peerIdStr);
    const blockCountPeerTracker = this.blockCountTrackersByPeer.getOrDefault(peerIdStr);

    const rateTrackers = [
      {tracker: this.requestCountTotalTracker, count: 1, applyPenalty: false, name: "requestCountTotalTracker"},
      {tracker: requestCountPeerTracker, count: 1, applyPenalty: true, name: "requestCountPeerTracker"},
    ];

    if (numBlock !== undefined) {
      rateTrackers.push(
        ...[
          {
            tracker: this.blockCountTotalTracker,
            count: numBlock,
            applyPenalty: false,
            name: "blockCountTotalTracker",
          },
          {tracker: blockCountPeerTracker, count: numBlock, applyPenalty: true, name: "blockCountPeerTracker"},
        ]
      );
    }

    for (const {tracker, count, applyPenalty, name} of rateTrackers) {
      if (tracker.requestObjects(count) === 0) {
        this.logger.warn("Do not serve request due to rate limit", {
          peerId: peerIdStr,
          blockCount: numBlock ?? 0,
          rateTracker: name,
          requestsWithinWindow: tracker.getRequestedObjectsWithinWindow(),
        });
        if (applyPenalty) {
          this.peerRpcScores.applyAction(peerId, PeerAction.Fatal, "RateLimit");
        }
        return false;
      }
    }

    return true;
  }
}
