import {BeaconBlockBody, BeaconState} from "@chainsafe/lodestar-types";

import {EpochContext} from "../util";


export function processEth1Data(
  epochCtx: EpochContext,
  state: BeaconState,
  body: BeaconBlockBody
): void {
  const {Eth1Data} = epochCtx.config.types;
  const {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} = epochCtx.config.params;
  const SLOTS_PER_ETH1_VOTING_PERIOD = EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH;
  const newEth1Data = body.eth1Data;
  // Convert to tree-backed, this is what it looks like in the state,
  // and hash-tree-root caching speeds things up a lot during the vote counting.
  const newEth1DataCached = Eth1Data.tree.asTreeBacked(Eth1Data.tree.fromStructural(newEth1Data));
  // Count it as vote
  state.eth1DataVotes.push(newEth1DataCached);
  // If there are not more than 50% votes, then we do not have to count to find a winner.
  if (state.eth1DataVotes.length * 2 <= SLOTS_PER_ETH1_VOTING_PERIOD) {
    return;
  }
  if (Eth1Data.equals(state.eth1Data, newEth1DataCached)) {
    return; // Nothing to do if the state already has this as eth1data (happens a lot after majority vote is in)
  }
  // TODO fast read-only iteration
  const sameVotesCount = Array.from(state.eth1DataVotes).filter((e) => Eth1Data.equals(e, newEth1DataCached)).length;
  if (sameVotesCount * 2 > SLOTS_PER_ETH1_VOTING_PERIOD) {
    state.eth1Data = newEth1Data;
  }
}
