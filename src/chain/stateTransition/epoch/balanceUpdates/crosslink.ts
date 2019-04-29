import BN from "bn.js";

import {BeaconState, Gwei} from "../../../../types";

import {
  getEpochStartSlot, getPreviousEpoch, getCurrentEpoch,
  getCrosslinkCommitteesAtSlot, getTotalBalance, slotToEpoch,
} from "../../util";

import {getWinningCrosslinkAndAttestingIndices} from "../util";
import {getBaseReward} from "./baseReward";


export function getCrosslinkDeltas(state: BeaconState): [Gwei[], Gwei[]] {
  const rewards = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const penalties = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const previousEpochStartSlot = getEpochStartSlot(getPreviousEpoch(state));
  const currentEpochStartSlot = getEpochStartSlot(getCurrentEpoch(state));
  for (let slot = previousEpochStartSlot; slot < currentEpochStartSlot; slot++) {
    const epoch = slotToEpoch(slot);
    getCrosslinkCommitteesAtSlot(state, slot).forEach(([crosslinkCommittee, shard]) => {
      const [_, attestingIndices] = getWinningCrosslinkAndAttestingIndices(state, shard, epoch);
      const attestingBalance = getTotalBalance(state, attestingIndices);
      const committeeBalance = getTotalBalance(state, crosslinkCommittee);
      crosslinkCommittee.forEach((index) => {
        const baseReward = getBaseReward(state, index);
        if (attestingIndices.includes(index)) {
          rewards[index] = rewards[index]
            .add(baseReward.mul(attestingBalance.div(committeeBalance)));
        } else {
          penalties[index] = penalties[index].add(baseReward);
        }
      });
    });
  }
  return [rewards, penalties];
}
