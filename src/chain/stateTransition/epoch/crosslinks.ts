/**
 * @module chain/stateTransition/epoch
 */

import {BeaconState} from "../../../types";
import {
  getCrosslinkCommitteesAtSlot,
  getCurrentEpoch,
  getEpochStartSlot,
  getPreviousEpoch,
  getTotalBalance,
  slotToEpoch,
} from "../util";

import {getWinningCrosslinkAndAttestingIndices} from "./util";


export function processCrosslinks(state: BeaconState): void {
  state.previousCrosslinks = state.currentCrosslinks.slice();

  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = getPreviousEpoch(state);
  const nextEpoch = currentEpoch + 1;

  const start = getEpochStartSlot(previousEpoch);
  const end = getEpochStartSlot(nextEpoch);
  for (let slot = start; slot < end; slot++) {
    const epoch = slotToEpoch(slot);
    getCrosslinkCommitteesAtSlot(state, slot).forEach(([crosslinkCommittee, shard]) => {
      const [winningCrosslink, participants] =
        getWinningCrosslinkAndAttestingIndices(state, shard, epoch);
      const participatingBalance = getTotalBalance(state, participants);
      const totalBalance = getTotalBalance(state, crosslinkCommittee);
      if (participatingBalance.muln(3).gte(totalBalance.muln(2))) {
        state.currentCrosslinks[shard] = winningCrosslink;
      }
    });
  }
}
