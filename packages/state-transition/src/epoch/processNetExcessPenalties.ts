import {PARTICIPATION_FLAG_WEIGHTS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {CachedBeaconStateEIP7716} from "../types.js";
import {getPreviousEpoch} from "../util/epoch.js";
import {computePenaltyFactor} from "../util/eip7716.js";

export function processNetExcessPenalties(state: CachedBeaconStateEIP7716): void {
  const lastSlotPrevEpoch = getPreviousEpoch(state) + SLOTS_PER_EPOCH - 1;
  for (let flagIndex = 0; flagIndex < PARTICIPATION_FLAG_WEIGHTS.length; flagIndex++) {
    const {netExcessPenalty} = computePenaltyFactor(state, lastSlotPrevEpoch, flagIndex);
    state.netExcessPenalties.set(flagIndex, netExcessPenalty);
  }
}
