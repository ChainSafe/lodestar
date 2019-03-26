import BN from "bn.js";

import {
  BeaconBlock,
  BeaconState,
  Eth1DataVote,
} from "../../../types";

export default function processEth1Data(state: BeaconState, block: BeaconBlock): void {
  const eth1DataVote: Eth1DataVote = state.eth1DataVotes.find((vote) =>
    vote.eth1Data.blockHash.equals(block.eth1Data.blockHash) &&
    vote.eth1Data.depositRoot.equals(block.eth1Data.depositRoot));

  if (eth1DataVote) {
    eth1DataVote.voteCount++;
  } else {
    state.eth1DataVotes.push({
      eth1Data: block.eth1Data,
      voteCount: 1,
    });
  }
}
