/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState, Gwei} from "../../../../types";
import {IBeaconConfig} from "../../../../config";

import {
  getCrosslinkCommittee,
  getEpochCommitteeCount,
  getEpochStartShard,
  getPreviousEpoch,
  getTotalBalance,
} from "../../util";

import {getWinningCrosslinkAndAttestingIndices} from "../util";
import {getBaseReward} from "./baseReward";


export function getCrosslinkDeltas(config: IBeaconConfig, state: BeaconState): [Gwei[], Gwei[]] {
  const rewards = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const penalties = Array.from({length: state.validatorRegistry.length}, () => new BN(0));
  const previousEpoch = getPreviousEpoch(config, state);
  const comitteeCount = getEpochCommitteeCount(config, state, previousEpoch);
  for (let offset = 0; offset < comitteeCount; offset++) {
    const shard = (getEpochStartShard(config, state, previousEpoch) + offset) % config.params.SHARD_COUNT;
    const crosslinkCommittee = getCrosslinkCommittee(config, state, previousEpoch, shard);
    const [_, attestingIndices] =
      getWinningCrosslinkAndAttestingIndices(config, state, previousEpoch, shard);
    const attestingBalance = getTotalBalance(state, attestingIndices);
    const committeeBalance = getTotalBalance(state, crosslinkCommittee);
    crosslinkCommittee.forEach((index) => {
      const baseReward = getBaseReward(config, state, index);
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
