/**
 * @module chain/stateTransition/block
 */

import {BeaconBlockBody, BeaconState, Eth1Data} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function processEth1Data(config: IBeaconConfig, state: BeaconState, body: BeaconBlockBody): void {
  const newEth1Data = getNewEth1Data(config, state, body.eth1Data);
  if (newEth1Data) {
    state.eth1Data = body.eth1Data;
  }

  state.eth1DataVotes.push(body.eth1Data);
}

/**
 * Returns `newEth1Data` if adding the given `eth1Data` to `state.eth1DataVotes` would
 * result in a change to `state.eth1Data`.
 */
export function getNewEth1Data(config: IBeaconConfig, state: BeaconState, eth1Data: Eth1Data): Eth1Data | null {
  const numVotes = Array.from(state.eth1DataVotes).filter((vote) => config.types.Eth1Data.equals(vote, eth1Data))
    .length;

  // The +1 is to account for the `eth1Data` supplied to the function.
  if ((numVotes + 1) * 2 > config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * config.params.SLOTS_PER_EPOCH) {
    return eth1Data;
  } else {
    return null;
  }
}
