import {CachedBeaconStateDecoupled} from "../types.js";
import {processParticipationFlagUpdates} from "./processParticipationFlagUpdates.js";

// Spec: process_round (decoupled-consensus/beacon-chain.md)
export function processRound(state: CachedBeaconStateDecoupled): void {
  // [TODO in spec: process_inactivity_updates(state)]
  // [TODO in spec: process_rewards_and_penalties(state)]
  processParticipationFlagUpdates(state);
}
