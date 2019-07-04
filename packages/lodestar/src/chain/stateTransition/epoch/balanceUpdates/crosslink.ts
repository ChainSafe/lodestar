/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState, Gwei} from "../../../../../types";
import {SHARD_COUNT} from "../../../../constants";

import {
  getCrosslinkCommittee,
  getEpochCommitteeCount,
  getEpochStartShard,
  getPreviousEpoch,
  getTotalBalance,
} from "../../util";

import {getWinningCrosslinkAndAttestingIndices} from "../util";
import {getBaseReward} from "./baseReward";


export function getCrosslinkDeltas(state: BeaconState): [Gwei[], Gwei[]] {
  const rewards = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const penalties = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const previousEpoch = getPreviousEpoch(state);
  const comitteeCount = getEpochCommitteeCount(state, previousEpoch);
  for (let offset = 0; offset < comitteeCount; offset++) {
    const shard = (getEpochStartShard(state, previousEpoch) + offset) % SHARD_COUNT;
    const crosslinkCommittee = getCrosslinkCommittee(state, previousEpoch, shard);
    const [_, attestingIndices] =
      getWinningCrosslinkAndAttestingIndices(state, previousEpoch, shard);
    const attestingBalance = getTotalBalance(state, attestingIndices);
    const committeeBalance = getTotalBalance(state, crosslinkCommittee);
    crosslinkCommittee.forEach((index) => {
      const baseReward = getBaseReward(state, index);
      if (attestingIndices.includes(index)) {
        rewards[index] = rewards[index]
          .add(baseReward.mul(attestingBalance).div(committeeBalance));
      } else {
        penalties[index] = penalties[index].add(baseReward);
      }
    });
  }
  return [rewards, penalties];
}
