import {phase0} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";
import {CachedBeaconState} from "../util";

export function processEth1Data(state: CachedBeaconState<phase0.BeaconState>, body: phase0.BeaconBlockBody): void {
  const newEth1Data = getNewEth1Data(state, body.eth1Data);
  if (newEth1Data) {
    state.eth1Data = body.eth1Data;
  }

  state.eth1DataVotes.push(body.eth1Data);
}

/**
 * Returns `newEth1Data` if adding the given `eth1Data` to `state.eth1DataVotes` would
 * result in a change to `state.eth1Data`.
 */
export function getNewEth1Data(
  state: CachedBeaconState<phase0.BeaconState>,
  newEth1Data: phase0.Eth1Data
): phase0.Eth1Data | null {
  const {config} = state;
  const {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} = config.params;
  const SLOTS_PER_ETH1_VOTING_PERIOD = EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH;

  // If there are not more than 50% votes, then we do not have to count to find a winner.
  if ((state.eth1DataVotes.length + 1) * 2 <= SLOTS_PER_ETH1_VOTING_PERIOD) {
    return null;
  }
  if (config.types.phase0.Eth1Data.equals(state.eth1Data, newEth1Data)) {
    return null; // Nothing to do if the state already has this as eth1data (happens a lot after majority vote is in)
  }
  const sameVotesCount = Array.from(readonlyValues(state.eth1DataVotes)).filter((e) =>
    config.types.phase0.Eth1Data.equals(e, newEth1Data)
  ).length;

  // The +1 is to account for the `eth1Data` supplied to the function.
  if ((sameVotesCount + 1) * 2 > SLOTS_PER_ETH1_VOTING_PERIOD) {
    return newEth1Data;
  } else {
    return null;
  }
}
