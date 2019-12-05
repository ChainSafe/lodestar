import {IEth1Notifier} from "../interface";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BeaconState, Eth1Data, number64} from "@chainsafe/eth2.0-types";
import {intSqrt} from "@chainsafe/eth2.0-utils";
import {arrayIntersection, mostFrequent, sszEqualPredicate} from "../../util/objects";
import {equals} from "@chainsafe/ssz";
import {Block} from "ethers/providers";

export async function getEth1Vote(
  this: IEth1Notifier, config: IBeaconConfig, state: BeaconState, previousEth1Distance: number64
): Promise<Eth1Data> {
  const eth1Head = await this.getHead();
  const allEth1Data = await getEth1DataRange(
    this.getEth1Data,
    eth1Head,
    config.params.ETH1_FOLLOW_DISTANCE,
    previousEth1Distance
  );

  const periodTail =
        state.slot % config.params.SLOTS_PER_ETH1_VOTING_PERIOD
        >=
        intSqrt(config.params.SLOTS_PER_ETH1_VOTING_PERIOD);
  let votesToConsider: Eth1Data[];
  if(periodTail) {
    votesToConsider = allEth1Data;
  } else {
    votesToConsider = await getEth1DataRange(
      this.getEth1Data,
      eth1Head,
      config.params.ETH1_FOLLOW_DISTANCE,
      2 * config.params.ETH1_FOLLOW_DISTANCE
    );
  }

  const validVotes = arrayIntersection<Eth1Data>(
    state.eth1DataVotes,
    votesToConsider,
    sszEqualPredicate(config.types.Eth1Data)
  );

  if(validVotes.length > 0) {
    const frequentVotes = mostFrequent<Eth1Data>(validVotes, config.types.Eth1Data);
    if(frequentVotes.length === 1) {
      return frequentVotes[0];
    } else {
      return allEth1Data[Math.max(...frequentVotes.map(
        (vote) => allEth1Data.findIndex((eth1Data) => equals(vote, eth1Data, config.types.Eth1Data)))
      )];
    }
  } else {
    return this.getEth1Data(eth1Head, config.params.ETH1_FOLLOW_DISTANCE);
  }
}

async function getEth1DataRange(
  getEth1Data: (eth1Head: Block, distance: number64) => Promise<Eth1Data>,
  eth1Head: Block,
  startDistance: number64,
  endDistance: number64
): Promise<Eth1Data[]> {
  const promises: Promise<Eth1Data>[] = [];
  for(let distance = startDistance; distance < endDistance; distance++) {
    promises.push(getEth1Data(eth1Head, distance));
  }
  return await Promise.all(promises);
}