import {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {readonlyValues, toHexString} from "@chainsafe/ssz";

import {CachedBeaconState} from "../util";

export function processEth1Data(state: CachedBeaconState<allForks.BeaconState>, body: allForks.BeaconBlockBody): void {
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
  state: CachedBeaconState<allForks.BeaconState>,
  newEth1Data: phase0.Eth1Data
): phase0.Eth1Data | null {
  const SLOTS_PER_ETH1_VOTING_PERIOD = EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH;
  const SLOTS_PER_ETH1_VOTING_PERIOD_HALF = SLOTS_PER_ETH1_VOTING_PERIOD / 2;

  // If there are not more than 50% votes, then we do not have to count to find a winner.
  if (state.eth1DataVotes.length + 1 <= SLOTS_PER_ETH1_VOTING_PERIOD_HALF) {
    return null;
  }

  const newEth1DataSerialized = serializeEth1Data(newEth1Data);
  if (serializeEth1Data(state.eth1Data) === newEth1DataSerialized) {
    return null; // Nothing to do if the state already has this as eth1data (happens a lot after majority vote is in)
  }

  // The +1 is to account for the `eth1Data` supplied to the function.
  let sameVotesCount = 1;
  for (const eth1DataVote of readonlyValues(state.eth1DataVotes)) {
    if (serializeEth1Data(eth1DataVote) === newEth1DataSerialized) {
      sameVotesCount++;

      // Would result in a change of eth1Data to the new one
      if (sameVotesCount > SLOTS_PER_ETH1_VOTING_PERIOD_HALF) {
        return newEth1Data;
      }
    }
  }

  // Not enough votes, won't change the result
  return null;
}

/**
 * Serialize eth1Data types to a unique string ID. It is only used for comparison.
 * This serializer is x15 times faster than ssz.phase0.Eth1Data.equals()
 */
function serializeEth1Data(eth1Data: phase0.Eth1Data): string {
  return toHexString(eth1Data.blockHash) + eth1Data.depositCount.toString(16) + toHexString(eth1Data.depositRoot);
}
