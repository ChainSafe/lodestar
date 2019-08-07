/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  getCurrentEpoch,
  getPreviousEpoch,
  getTotalBalance,
  getCommitteeCount,
  getStartShard,
  getCrosslinkCommittee,
} from "../util";
import {getWinningCrosslinkAndAttestingIndices} from "./util";


export function processCrosslinks(config: IBeaconConfig, state: BeaconState): void {
  state.previousCrosslinks = state.currentCrosslinks.slice();

  const currentEpoch = getCurrentEpoch(config, state);
  const previousEpoch = getPreviousEpoch(config, state);
  [previousEpoch, currentEpoch].forEach((epoch) => {
    const comitteeCount = getCommitteeCount(config, state, epoch);
    for (let offset = 0; offset < comitteeCount; offset++) {
      const shard = (getStartShard(config, state, epoch) + offset) % config.params.SHARD_COUNT;
      const crosslinkCommittee = getCrosslinkCommittee(config, state, epoch, shard);
      const [winningCrosslink, attestingIndices] =
        getWinningCrosslinkAndAttestingIndices(config, state, epoch, shard);
      if (getTotalBalance(state, attestingIndices).muln(3)
        .gte(getTotalBalance(state, crosslinkCommittee).muln(2))) {
        state.currentCrosslinks[shard] = winningCrosslink;
      }
    }
  });
}
