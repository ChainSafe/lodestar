import {IEth1Notifier} from "../interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Eth1Data} from "@chainsafe/lodestar-types";
import {arrayIntersection, mostFrequent, sszEqualPredicate} from "../../util/objects";
import {votingPeriodStartTime} from "./utils";

export async function getEth1Vote(
  this: IEth1Notifier, config: IBeaconConfig, state: BeaconState): Promise<Eth1Data> {
  const periodStart = votingPeriodStartTime(config, state);
  const promises: Promise<Eth1Data>[] = this.findBlocks(config, periodStart).map(block => this.getEth1Data(block));
  const votesToConsider: Eth1Data[] = await Promise.all(promises);

  const validVotes = arrayIntersection<Eth1Data>(
    Array.from(state.eth1DataVotes),
    votesToConsider,
    sszEqualPredicate(config.types.Eth1Data)
  );

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
    const defaultVote: Eth1Data = votesToConsider.length > 0 ?
      votesToConsider[votesToConsider.length - 1] : state.eth1Data;
    return defaultVote;
  }
}
