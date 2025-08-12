import {PeerId} from "@libp2p/interface";
import {Logger, MapDef, pruneSetToMax} from "@lodestar/utils";
import {GoodByeReasonCode} from "../../../constants/network.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {NetworkCoreMetrics} from "../../core/metrics.js";
import {prettyPrintPeerId} from "../../util.js";
import {DEFAULT_SCORE, MAX_ENTRIES, MAX_SCORE, MIN_SCORE, SCORE_THRESHOLD} from "./constants.js";
import {IPeerRpcScoreStore, IPeerScore, PeerAction, PeerRpcScoreOpts, PeerScoreStats, ScoreState} from "./interface.js";
import {MaxScore, RealScore} from "./score.js";
import {scoreToState} from "./utils.js";

const peerActionScore: Record<PeerAction, number> = {
  [PeerAction.Fatal]: -(MAX_SCORE - MIN_SCORE),
  [PeerAction.LowToleranceError]: -10,
  [PeerAction.MidToleranceError]: -5,
  [PeerAction.HighToleranceError]: -1,
};

/**
 * A peer's score (perceived potential usefulness).
 * This simplistic version consists of a global score per peer which decays to 0 over time.
 * The decay rate applies equally to positive and negative scores.
 * Peer cool-down period will be checked before dialing and will only be dialed if score is not waiting to decay
 */
export class PeerRpcScoreStore implements IPeerRpcScoreStore {
  private readonly scores: MapDef<PeerIdStr, IPeerScore>;
  private readonly metrics: NetworkCoreMetrics | null;
  private readonly logger: Logger | null;

  // TODO: Persist scores, at least BANNED status to disk

  constructor(opts: PeerRpcScoreOpts = {}, metrics: NetworkCoreMetrics | null = null, logger: Logger | null = null) {
    this.metrics = metrics;
    this.logger = logger;
    this.scores = opts.disablePeerScoring ? new MapDef(() => new MaxScore()) : new MapDef(() => new RealScore());
  }

  getScore(peer: PeerId): number {
    return this.scores.get(peer.toString())?.getScore() ?? DEFAULT_SCORE;
  }

  getGossipScore(peer: PeerId): number {
    return this.scores.get(peer.toString())?.getGossipScore() ?? DEFAULT_SCORE;
  }

  getScoreState(peer: PeerId): ScoreState {
    return scoreToState(this.getScore(peer));
  }

  isCoolingDown(peerIdStr: PeerIdStr): boolean {
    return this.scores.get(peerIdStr)?.isCoolingDown() ?? false;
  }

  dumpPeerScoreStats(): PeerScoreStats {
    return Array.from(this.scores.entries()).map(([peerId, peerScore]) => ({peerId, ...peerScore.getStat()}));
  }

  applyAction(peer: PeerId, action: PeerAction, actionName: string): void {
    const peerScore = this.scores.getOrDefault(peer.toString());
    const scoreChange = peerActionScore[action];
    const newScore = peerScore.add(scoreChange);

    this.logger?.debug("peer score adjusted", {scoreChange, newScore, peerId: prettyPrintPeerId(peer), actionName});
    this.metrics?.peersReportPeerCount.inc({reason: actionName});
  }

  /**
   * Apply a reconnection cool-down period to prevent automatic reconnection. Sets peer
   * banning period and updates gossip score to -1 so next update removes the negative
   * score
   */
  applyReconnectionCoolDown(peer: PeerIdStr, reason: GoodByeReasonCode): number {
    const peerScore = this.scores.getOrDefault(peer);
    return peerScore.applyReconnectionCoolDown(reason);
  }

  update(): void {
    // Bound size of data structures
    pruneSetToMax(this.scores, MAX_ENTRIES);

    for (const [peerIdStr, peerScore] of this.scores) {
      const newScore = peerScore.update();

      // Prune scores below threshold
      if (Math.abs(newScore) < SCORE_THRESHOLD) {
        this.scores.delete(peerIdStr);
      }
    }
  }

  updateGossipsubScore(peerId: PeerIdStr, newScore: number, ignore: boolean): void {
    const peerScore = this.scores.getOrDefault(peerId);
    peerScore.updateGossipsubScore(newScore, ignore);
  }
}
