import {PeerId} from "@libp2p/interface-peer-id";
import {MapDef, pruneSetToMax} from "@lodestar/utils";
import {gossipScoreThresholds, negativeGossipScoreIgnoreThreshold} from "../gossip/scoringParameters.js";
import {Metrics} from "../../metrics/index.js";

/** The default score for new peers */
const DEFAULT_SCORE = 0;
/** The minimum reputation before a peer is disconnected */
const MIN_SCORE_BEFORE_DISCONNECT = -20;
/** The minimum reputation before a peer is banned */
const MIN_SCORE_BEFORE_BAN = -50;
// If a peer has a lodestar score below this constant all other score parts will get ignored and
// the peer will get banned regardless of the other parts.
const MIN_LODESTAR_SCORE_BEFORE_BAN = -60.0;
/** The maximum score a peer can obtain. Update metrics.peerScore if this changes */
const MAX_SCORE = 100;
/** The minimum score a peer can obtain. Update metrics.peerScore if this changes */
const MIN_SCORE = -100;
/** Drop score if absolute value is below this threshold */
const SCORE_THRESHOLD = 1;
/** The halflife of a peer's score. I.e the number of milliseconds it takes for the score to decay to half its value */
const SCORE_HALFLIFE_MS = 10 * 60 * 1000;
const HALFLIFE_DECAY_MS = -Math.log(2) / SCORE_HALFLIFE_MS;
/** The number of milliseconds we ban a peer for before their score begins to decay */
const BANNED_BEFORE_DECAY_MS = 30 * 60 * 1000;
/** Limit of entries in the scores map */
const MAX_ENTRIES = 1000;
/**
 * We weight negative gossipsub scores in such a way that they never result in a disconnect by
 * themselves. This "solves" the problem of non-decaying gossipsub scores for disconnected peers.
 */
const GOSSIPSUB_NEGATIVE_SCORE_WEIGHT = (MIN_SCORE_BEFORE_DISCONNECT + 1) / gossipScoreThresholds.graylistThreshold;
const GOSSIPSUB_POSITIVE_SCORE_WEIGHT = GOSSIPSUB_NEGATIVE_SCORE_WEIGHT;

export enum PeerAction {
  /** Immediately ban peer */
  Fatal = "Fatal",
  /**
   * Not malicious action, but it must not be tolerated
   * ~5 occurrences will get the peer banned
   */
  LowToleranceError = "LowToleranceError",
  /**
   * Negative action that can be tolerated only sometimes
   * ~10 occurrences will get the peer banned
   */
  MidToleranceError = "MidToleranceError",
  /**
   * Some error that can be tolerated multiple times
   * ~50 occurrences will get the peer banned
   */
  HighToleranceError = "HighToleranceError",
}

const peerActionScore: Record<PeerAction, number> = {
  [PeerAction.Fatal]: -(MAX_SCORE - MIN_SCORE),
  [PeerAction.LowToleranceError]: -10,
  [PeerAction.MidToleranceError]: -5,
  [PeerAction.HighToleranceError]: -1,
};

export enum ScoreState {
  /** We are content with the peers performance. We permit connections and messages. */
  Healthy = "Healthy",
  /** The peer should be disconnected. We allow re-connections if the peer is persistent */
  Disconnected = "Disconnected",
  /** The peer is banned. We disallow new connections until it's score has decayed into a tolerable threshold */
  Banned = "Banned",
}

function scoreToState(score: number): ScoreState {
  if (score <= MIN_SCORE_BEFORE_BAN) return ScoreState.Banned;
  if (score <= MIN_SCORE_BEFORE_DISCONNECT) return ScoreState.Disconnected;
  return ScoreState.Healthy;
}

type PeerIdStr = string;

export interface IPeerRpcScoreStore {
  getScore(peer: PeerId): number;
  getGossipScore(peer: PeerId): number;
  getScoreState(peer: PeerId): ScoreState;
  dumpPeerScoreStats(): PeerScoreStats;
  applyAction(peer: PeerId, action: PeerAction, actionName: string): void;
  update(): void;
  updateGossipsubScore(peerId: PeerIdStr, newScore: number, ignore: boolean): void;
}

export type PeerRpcScoreStoreModules = {
  metrics: Metrics | null;
};

export type PeerScoreStats = ({peerId: PeerIdStr} & PeerScoreStat)[];

export type PeerScoreStat = {
  lodestarScore: number;
  gossipScore: number;
  ignoreNegativeGossipScore: boolean;
  score: number;
  lastUpdate: number;
};

/**
 * A peer's score (perceived potential usefulness).
 * This simplistic version consists of a global score per peer which decays to 0 over time.
 * The decay rate applies equally to positive and negative scores.
 */
export class PeerRpcScoreStore implements IPeerRpcScoreStore {
  private readonly scores = new MapDef<PeerIdStr, PeerScore>(() => new PeerScore());
  private readonly metrics: Metrics | null;

  // TODO: Persist scores, at least BANNED status to disk

  constructor(metrics: Metrics | null = null) {
    this.metrics = metrics;
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

  dumpPeerScoreStats(): PeerScoreStats {
    return Array.from(this.scores.entries()).map(([peerId, peerScore]) => ({peerId, ...peerScore.getStat()}));
  }

  applyAction(peer: PeerId, action: PeerAction, actionName: string): void {
    const peerScore = this.scores.getOrDefault(peer.toString());
    peerScore.add(peerActionScore[action]);

    this.metrics?.peersReportPeerCount.inc({reason: actionName});
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

/**
 * Manage score of a peer.
 */
export class PeerScore {
  private lodestarScore: number;
  private gossipScore: number;
  private ignoreNegativeGossipScore: boolean;
  /** The final score, computed from the above */
  private score: number;
  private lastUpdate: number;

  constructor() {
    this.lodestarScore = DEFAULT_SCORE;
    this.gossipScore = DEFAULT_SCORE;
    this.score = DEFAULT_SCORE;
    this.ignoreNegativeGossipScore = false;
    this.lastUpdate = Date.now();
  }

  getScore(): number {
    return this.score;
  }

  getGossipScore(): number {
    return this.gossipScore;
  }

  add(scoreDelta: number): void {
    let newScore = this.lodestarScore + scoreDelta;
    if (newScore > MAX_SCORE) newScore = MAX_SCORE;
    if (newScore < MIN_SCORE) newScore = MIN_SCORE;

    this.setLodestarScore(newScore);
  }

  /**
   * Applies time-based logic such as decay rates to the score.
   * This function should be called periodically.
   *
   * Return the new score.
   */
  update(): number {
    const nowMs = Date.now();

    // Decay the current score
    // Using exponential decay based on a constant half life.
    const sinceLastUpdateMs = nowMs - this.lastUpdate;
    // If peer was banned, lastUpdate will be in the future
    if (sinceLastUpdateMs > 0) {
      this.lastUpdate = nowMs;
      // e^(-ln(2)/HL*t)
      const decayFactor = Math.exp(HALFLIFE_DECAY_MS * sinceLastUpdateMs);
      this.setLodestarScore(this.lodestarScore * decayFactor);
    }

    return this.lodestarScore;
  }

  updateGossipsubScore(newScore: number, ignore: boolean): void {
    // we only update gossipsub if last_updated is in the past which means either the peer is
    // not banned or the BANNED_BEFORE_DECAY time is over.
    if (this.lastUpdate <= Date.now()) {
      this.gossipScore = newScore;
      this.ignoreNegativeGossipScore = ignore;
    }
  }

  getStat(): PeerScoreStat {
    return {
      lodestarScore: this.lodestarScore,
      gossipScore: this.gossipScore,
      ignoreNegativeGossipScore: this.ignoreNegativeGossipScore,
      score: this.score,
      lastUpdate: this.lastUpdate,
    };
  }

  /**
   * Updating lodestarScore should always go through this method,
   * so that we update this.score accordingly.
   */
  private setLodestarScore(newScore: number): void {
    this.lodestarScore = newScore;
    this.updateState();
  }

  /**
   * Compute the final score, ban peer if needed
   */
  private updateState(): void {
    const prevState = scoreToState(this.score);
    this.recomputeScore();
    const newState = scoreToState(this.score);

    if (prevState !== ScoreState.Banned && newState === ScoreState.Banned) {
      // ban this peer for at least BANNED_BEFORE_DECAY_MS seconds
      this.lastUpdate = Date.now() + BANNED_BEFORE_DECAY_MS;
    }
  }

  /**
   * Compute the final score
   */
  private recomputeScore(): void {
    this.score = this.lodestarScore;
    if (this.score <= MIN_LODESTAR_SCORE_BEFORE_BAN) {
      // ignore all other scores, i.e. do nothing here
      return;
    }

    if (this.gossipScore >= 0) {
      this.score += this.gossipScore * GOSSIPSUB_POSITIVE_SCORE_WEIGHT;
    } else if (!this.ignoreNegativeGossipScore) {
      this.score += this.gossipScore * GOSSIPSUB_NEGATIVE_SCORE_WEIGHT;
    }
  }
}

/**
 * Utility to update gossipsub score of connected peers
 */
export function updateGossipsubScores(
  peerRpcScores: IPeerRpcScoreStore,
  gossipsubScores: Map<string, number>,
  toIgnoreNegativePeers: number
): void {
  // sort by gossipsub score desc
  const sortedPeerIds = Array.from(gossipsubScores.keys()).sort(
    (a, b) => (gossipsubScores.get(b) ?? 0) - (gossipsubScores.get(a) ?? 0)
  );
  for (const peerId of sortedPeerIds) {
    const gossipsubScore = gossipsubScores.get(peerId);
    if (gossipsubScore !== undefined) {
      let ignore = false;
      if (gossipsubScore < 0 && gossipsubScore > negativeGossipScoreIgnoreThreshold && toIgnoreNegativePeers > 0) {
        // We ignore the negative score for the best negative peers so that their
        // gossipsub score can recover without getting disconnected.
        ignore = true;
        toIgnoreNegativePeers -= 1;
      }

      peerRpcScores.updateGossipsubScore(peerId, gossipsubScore, ignore);
    }
  }
}
