/**
 * @module chain/blockAssembly
 */

import {Eth1Data} from "../../../types";
import {IEth1Notifier} from "../../../eth1";
import {ETH1_FOLLOW_DISTANCE} from "../../../constants";

export async function bestVoteData(votes: Eth1Data[]): Promise<Eth1Data> {
  const potentialVotes = votes.filter(vote => {
    //TODO: check vote
    /**
     * vote.eth1_data.block_hash is the hash of an eth1.0 block that is
     * (i) part of the canonical chain, (ii) >= ETH1_FOLLOW_DISTANCE blocks behind the head,
     * and (iii) newer than state.latest_eth1_data.block_data.
     *
     * vote.eth1_data.deposit_count is the deposit count of the eth1.0 deposit contract
     * at the block defined by vote.eth1_data.block_hash.
     *
     * vote.eth1_data.deposit_root is the deposit root of the eth1.0 deposit contract at
     * the block defined by vote.eth1_data.block_hash.
     */
  });

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
