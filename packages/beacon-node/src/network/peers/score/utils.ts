import {negativeGossipScoreIgnoreThreshold} from "../../gossip/scoringParameters.js";
import {MIN_SCORE_BEFORE_BAN, MIN_SCORE_BEFORE_DISCONNECT} from "./constants.js";
import {IPeerRpcScoreStore, ScoreState} from "./interface.js";

export function scoreToState(score: number): ScoreState {
  if (score <= MIN_SCORE_BEFORE_BAN) return ScoreState.Banned;
  if (score <= MIN_SCORE_BEFORE_DISCONNECT) return ScoreState.Disconnected;
  return ScoreState.Healthy;
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
