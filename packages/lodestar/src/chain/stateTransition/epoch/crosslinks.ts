/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../../types";
import {
  getCurrentEpoch,
  getPreviousEpoch,
  getTotalBalance,
  getEpochCommitteeCount,
  getEpochStartShard,
  getCrosslinkCommittee,
} from "../util";

import {getWinningCrosslinkAndAttestingIndices} from "./util";
import {SHARD_COUNT} from "../../../constants";


export function processCrosslinks(state: BeaconState): BeaconState {
  state.previousCrosslinks = state.currentCrosslinks.slice();

  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = getPreviousEpoch(state);
  [previousEpoch, currentEpoch].forEach((epoch) => {
    const comitteeCount = getEpochCommitteeCount(state, epoch);
    for (let offset = 0; offset < comitteeCount; offset++) {
      const shard = (getEpochStartShard(state, epoch) + offset) % SHARD_COUNT;
      const crosslinkCommittee = getCrosslinkCommittee(state, epoch, shard);
      const [winningCrosslink, attestingIndices] =
        getWinningCrosslinkAndAttestingIndices(state, epoch, shard);
      if (getTotalBalance(state, attestingIndices).muln(3)
        .gte(getTotalBalance(state, crosslinkCommittee).muln(2))) {
        state.currentCrosslinks[shard] = winningCrosslink;
      }
    }
  });
  return state;
}
