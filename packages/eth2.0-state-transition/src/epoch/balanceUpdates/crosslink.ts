/**
 * @module chain/stateTransition/epoch
 */


import {BeaconState, Gwei} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  getCrosslinkCommittee,
  getCommitteeCount,
  getStartShard,
  getPreviousEpoch,
  getTotalBalance,
} from "../../util";

import {getWinningCrosslinkAndAttestingIndices} from "../util";
import {getBaseReward} from "./baseReward";


export function getCrosslinkDeltas(config: IBeaconConfig, state: BeaconState): [Gwei[], Gwei[]] {
  const rewards = Array.from({length: state.validators.length}, () => 0n);
  const penalties = Array.from({length: state.validators.length}, () => 0n);
  const previousEpoch = getPreviousEpoch(config, state);
  const committeeCount = getCommitteeCount(config, state, previousEpoch);
  const startShard = getStartShard(config, state, previousEpoch);
  for (let offset = 0; offset < committeeCount; offset++) {
    const shard = (startShard + offset) % config.params.SHARD_COUNT;
    const crosslinkCommittee = getCrosslinkCommittee(config, state, previousEpoch, shard);
    const [_, attestingIndices] =
      getWinningCrosslinkAndAttestingIndices(config, state, previousEpoch, shard);
    const attestingBalance = getTotalBalance(state, attestingIndices);
    const committeeBalance = getTotalBalance(state, crosslinkCommittee);
    crosslinkCommittee.forEach((index) => {
      const baseReward = getBaseReward(config, state, index);
      if (attestingIndices.includes(index)) {
        rewards[index] = rewards[index] + (baseReward * attestingBalance / committeeBalance);
      } else {
        penalties[index] = penalties[index] + baseReward;
      }
    });
  }
  return [rewards, penalties];
}
