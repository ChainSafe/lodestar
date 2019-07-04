/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../types";
import {BeaconConfig} from "../../../config";

import {
  getCurrentEpoch,
  getPreviousEpoch,
  getTotalBalance,
  getEpochCommitteeCount,
  getEpochStartShard,
  getCrosslinkCommittee,
} from "../util";
import {getWinningCrosslinkAndAttestingIndices} from "./util";


export function processCrosslinks(config: BeaconConfig, state: BeaconState): BeaconState {
  state.previousCrosslinks = state.currentCrosslinks.slice();

  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  [previousEpoch, currentEpoch].forEach((epoch) => {
    const comitteeCount = getEpochCommitteeCount(config, state, epoch);
    for (let offset = 0; offset < comitteeCount; offset++) {
      const shard = (getEpochStartShard(config, state, epoch) + offset) % config.params.SHARD_COUNT;
      const crosslinkCommittee = getCrosslinkCommittee(config, state, epoch, shard);
      const [winningCrosslink, attestingIndices] =
        getWinningCrosslinkAndAttestingIndices(config, state, epoch, shard);
      if (getTotalBalance(state, attestingIndices).muln(3)
        .gte(getTotalBalance(state, crosslinkCommittee).muln(2))) {
        state.currentCrosslinks[shard] = winningCrosslink;
      }
    }
  });
  return state;
}
