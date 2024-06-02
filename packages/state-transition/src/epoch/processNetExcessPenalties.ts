import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  HYSTERESIS_DOWNWARD_MULTIPLIER,
  HYSTERESIS_QUOTIENT,
  HYSTERESIS_UPWARD_MULTIPLIER,
  MAX_EFFECTIVE_BALANCE,
  TIMELY_TARGET_FLAG_INDEX,
} from "@lodestar/params";
import {EpochTransitionCache, CachedBeaconStateAllForks, BeaconStateAltair} from "../types.js";

export function processNetExcessPenalties(state: CachedBeaconStateAllForks): void {
  // TODO
}
