import {BeaconState, Epoch, Eth1DataVote} from "../../../types";
import {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} from "../../../constants";

export function processEth1Data(
  state: BeaconState,
  nextEpoch: Epoch): void {

  if (nextEpoch % EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes.forEach((vote: Eth1DataVote) => {

      // Check if more than half the votes were for that value
      if (vote.voteCount* 2 > EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH) {
        state.latestEth1Data = vote.eth1Data;
      }
    });

    // reset the votes for next round
    state.eth1DataVotes = [];
  }
}

