import {gossipScoreThresholds} from "../../gossip/scoringParameters.js";

/** The default score for new peers */
export const DEFAULT_SCORE = 0;
/** The minimum reputation before a peer is disconnected */
export const MIN_SCORE_BEFORE_DISCONNECT = -20;
/** The minimum reputation before a peer is banned */
export const MIN_SCORE_BEFORE_BAN = -50;
// If a peer has a lodestar score below this constant all other score parts will get ignored and
// the peer will get banned regardless of the other parts.
export const MIN_LODESTAR_SCORE_BEFORE_BAN = -60.0;
/** The maximum score a peer can obtain. Update metrics.peerScore if this changes */
export const MAX_SCORE = 100;
/** The minimum score a peer can obtain. Update metrics.peerScore if this changes */
export const MIN_SCORE = -100;
/** Drop score if absolute value is below this threshold */
export const SCORE_THRESHOLD = 1;
/** The halflife of a peer's score. I.e the number of milliseconds it takes for the score to decay to half its value */
export const SCORE_HALFLIFE_MS = 10 * 60 * 1000;
export const HALFLIFE_DECAY_MS = -Math.log(2) / SCORE_HALFLIFE_MS;
/** The number of milliseconds we ban a peer for before their score begins to decay */
export const BANNED_BEFORE_DECAY_MS = 30 * 60 * 1000;
/** Limit of entries in the scores map */
export const MAX_ENTRIES = 1000;

/**
 * We weight negative gossipsub scores in such a way that they never result in a disconnect by
 * themselves. This "solves" the problem of non-decaying gossipsub scores for disconnected peers.
 */
export const GOSSIPSUB_NEGATIVE_SCORE_WEIGHT =
  (MIN_SCORE_BEFORE_DISCONNECT + 1) / gossipScoreThresholds.graylistThreshold;
export const GOSSIPSUB_POSITIVE_SCORE_WEIGHT = GOSSIPSUB_NEGATIVE_SCORE_WEIGHT;
