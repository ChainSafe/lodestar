import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Eth1Data} from "@chainsafe/lodestar-types";
import {computeTimeAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";

import {IBeaconDb} from "../../../db";
import {mostFrequent} from "../../../util/objects";

export function votingPeriodStartTime(config: IBeaconConfig, state: BeaconState): number {
  const eth1VotingPeriodStartSlot = state.slot -
    state.slot % (config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * config.params.SLOTS_PER_EPOCH);
  return computeTimeAtSlot(config, eth1VotingPeriodStartSlot, state.genesisTime);
}

export async function getEth1Vote(
  config: IBeaconConfig,
  db: IBeaconDb,
  state: BeaconState,
): Promise<Eth1Data> {
  const periodStart = votingPeriodStartTime(config, state);
  const validEth1Data = await db.eth1Data.values({
    gte: periodStart - config. params.SECONDS_PER_ETH1_BLOCK * config.params.ETH1_FOLLOW_DISTANCE,
    lte: periodStart - config. params.SECONDS_PER_ETH1_BLOCK * config.params.ETH1_FOLLOW_DISTANCE * 2,
  });
  const votesToConsider: Record<string, boolean> = {};
  validEth1Data.forEach((eth1Data) => votesToConsider[toHexString(eth1Data.blockHash)] = true);

  const validVotes = Array.from(state.eth1DataVotes)
    .filter((eth1Data) => votesToConsider[toHexString(eth1Data.blockHash)]);

  if(validVotes.length > 0) {
    const frequentVotes = mostFrequent<Eth1Data>(config.types.Eth1Data, validVotes);
    if(frequentVotes.length === 1) {
      return frequentVotes[0];
    } else {
      return validVotes[Math.max(...frequentVotes.map(
        (vote) => validVotes.findIndex((eth1Data) => config.types.Eth1Data.equals(vote, eth1Data)))
      )];
    }
  } else {
    const defaultVote: Eth1Data = validEth1Data.length > 0 ?
      validEth1Data[validEth1Data.length - 1] : state.eth1Data;
    return defaultVote;
  }
}
