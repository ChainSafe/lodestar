/**
 * @module chain/stateTransition/block
 */

import {equals} from "@chainsafe/ssz";

import {
  BeaconBlockBody,
  BeaconState,
  Eth1Data,
} from "@chainsafe/eth2-types";

import {SLOTS_PER_ETH1_VOTING_PERIOD} from "@chainsafe/eth2-types";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#eth1-data

export function processEth1Data(state: BeaconState, body: BeaconBlockBody): void {
  const blockEth1Data = body.eth1Data;
  state.eth1DataVotes.push(blockEth1Data);
  let occurances = 0;
  state.eth1DataVotes.forEach((eth1Data) => {
    if (equals(blockEth1Data, eth1Data, Eth1Data)) {
      occurances++;
    }
  });
  if (occurances * 2 > SLOTS_PER_ETH1_VOTING_PERIOD) {
    state.latestEth1Data = body.eth1Data;
  }
}
