import {
  BANNED_BEFORE_DECAY_MS,
  DEFAULT_SCORE,
  GOSSIPSUB_NEGATIVE_SCORE_WEIGHT,
  GOSSIPSUB_POSITIVE_SCORE_WEIGHT,
  HALFLIFE_DECAY_MS,
  MAX_SCORE,
  MIN_LODESTAR_SCORE_BEFORE_BAN,
  MIN_SCORE,
} from "./constants.js";
import {IPeerScore, PeerScoreStat, ScoreState} from "./interface.js";
import {scoreToState} from "./utils.js";

/**
 * Manage score of a peer.
 */
export class RealScore implements IPeerScore {
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

/** An implementation of IPeerScore for testing */
export class MaxScore implements IPeerScore {
  getScore(): number {
    return MAX_SCORE;
  }

  getGossipScore(): number {
    return DEFAULT_SCORE;
  }

  add(): void {}

  update(): number {
    return MAX_SCORE;
  }

  updateGossipsubScore(): void {}

  getStat(): PeerScoreStat {
    return {
      lodestarScore: MAX_SCORE,
      gossipScore: DEFAULT_SCORE,
      ignoreNegativeGossipScore: false,
      score: MAX_SCORE,
      lastUpdate: Date.now(),
    };
  }
}
