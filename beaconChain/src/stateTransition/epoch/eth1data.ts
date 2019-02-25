import {BeaconBlock, BeaconState} from "../../../types";

export function processEth1Data(state: BeaconState): void {
  // ETH1 Data
  // If next_epoch % EPOCHS_PER_ETH1_VOTING_PERIOD == 0:
  //
  // If eth1_data_vote.vote_count * 2 > EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH for some eth1_data_vote in state.eth1_data_votes (ie. more than half the votes in this voting period were for that value), set state.latest_eth1_data = eth1_data_vote.eth1_data.
  //   Set state.eth1_data_votes = [].
  // if (nextEpoch.mod(new BN(EPOCHS_PER_ETH1_VOTING_PERIOD)).eqn(0)) {
  //   if (state.eth1)
  // }
}

