import PeerId from "peer-id";
import {IPeerMetadataStore} from "./metastore";

/** The default score for new peers */
const DEFAULT_SCORE = 0;
/** The minimum reputation before a peer is disconnected */
const MIN_SCORE_BEFORE_DISCONNECT = -20;
/** The minimum reputation before a peer is banned */
const MIN_SCORE_BEFORE_BAN = -50;
/** The maximum score a peer can obtain */
const MAX_SCORE = 100;
/** The minimum score a peer can obtain */
const MIN_SCORE = -100;
/** The halflife of a peer's score. I.e the number of miliseconds it takes for the score to decay to half its value */
const SCORE_HALFLIFE_MS = 10 * 60 * 1000;
const HALFLIFE_DECAY_MS = -Math.log(2) / SCORE_HALFLIFE_MS;
/** The number of miliseconds we ban a peer for before their score begins to decay */
const BANNED_BEFORE_DECAY_MS = 1800 * 1000;

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

export interface IPeerRpcScoreStore {
  getScore(peer: PeerId): number;
  getScoreState(peer: PeerId): ScoreState;
  applyAction(peer: PeerId, action: PeerAction, actionName?: string): void;
  update(peer: PeerId): void;
}

/**
 * A peer's score (perceived potential usefulness).
 * This simplistic version consists of a global score per peer which decays to 0 over time.
 * The decay rate applies equally to positive and negative scores.
 */
export class PeerRpcScoreStore implements IPeerRpcScoreStore {
  private readonly store: IPeerMetadataStore;

  constructor(store: IPeerMetadataStore) {
    this.store = store;
  }

  getScore(peer: PeerId): number {
    return this.store.rpcScore.get(peer) ?? DEFAULT_SCORE;
  }

  getScoreState(peer: PeerId): ScoreState {
    return scoreToState(this.getScore(peer));
  }

  applyAction(peer: PeerId, action: PeerAction, actionName?: string): void {
    this.add(peer, peerActionScore[action]);

    // TODO: Log action to debug + do metrics
    actionName;
  }

  update(peer: PeerId): void {
    this.add(peer, 0);
  }

  private decayScore(peer: PeerId, prevScore: number): number {
    const nowMs = Date.now();
    const lastUpdate = this.store.rpcScoreLastUpdate.get(peer) ?? nowMs;

    // Decay the current score
    // Using exponential decay based on a constant half life.
    const sinceLastUpdateMs = nowMs - lastUpdate;
    // If peer was banned, lastUpdate will be in the future
    if (sinceLastUpdateMs > 0 && prevScore !== 0) {
      this.store.rpcScoreLastUpdate.set(peer, nowMs);
      // e^(-ln(2)/HL*t)
      const decayFactor = Math.exp(HALFLIFE_DECAY_MS * sinceLastUpdateMs);
      return prevScore * decayFactor;
    } else {
      return prevScore;
    }
  }

  private add(peer: PeerId, scoreDelta: number): void {
    const prevScore = this.getScore(peer);

    let newScore = this.decayScore(peer, prevScore) + scoreDelta;
    if (newScore > MAX_SCORE) newScore = MAX_SCORE;
    if (newScore < MIN_SCORE) newScore = MIN_SCORE;

    const prevState = scoreToState(prevScore);
    const newState = scoreToState(newScore);
    if (prevState !== ScoreState.Banned && newState === ScoreState.Banned) {
      // ban this peer for at least BANNED_BEFORE_DECAY_MS seconds
      this.store.rpcScoreLastUpdate.set(peer, Date.now() + BANNED_BEFORE_DECAY_MS);
    }

    this.store.rpcScore.set(peer, newScore);
  }
}
