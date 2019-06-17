/**
 * @module chain/blockAssembly
 */

import {BeaconState, Eth1Data} from "../../../types";
import {IEth1Notifier} from "../../../eth1";
import {ETH1_FOLLOW_DISTANCE} from "../../../constants";

export async function bestVoteData(state: BeaconState, eth1: IEth1Notifier): Promise<Eth1Data> {
  const potentialVotes = [];
  const [head, latestStateBlock] = await Promise.all([
    eth1.getHead(),
    eth1.getBlock(state.latestEth1Data.blockHash.toString('hex'))
  ]);
  for(let i = 0; i < state.eth1DataVotes.length; i++) {
    const vote = state.eth1DataVotes[i];
    const block = await eth1.getBlock(vote.blockHash.toString('hex'));
    if(block
      && (head.number - block.number) >= ETH1_FOLLOW_DISTANCE
      && block.number > latestStateBlock.number
    ) {

    }
  }

  // if(potentialVotes.length === 0) {
  //   const blockHash = await eth1.getAncestoreBlockHash(eth1.latestBlockHash(), ETH1_FOLLOW_DISTANCE);
  //   return {
  //     blockHash,
  //     depositCount: await eth1.depositCount(blockHash),
  //     depositRoot: await eth1.depositRoot(blockHash)
  //   };
  // }

  //TODO: find Eth1Data with most votes(occurencies)

  return {
    depositRoot: undefined,
    depositCount: undefined,
    blockHash: undefined
  };
}
