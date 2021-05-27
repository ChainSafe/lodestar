/**
 * @module chain/stateTransition/block
 */

import {phase0, ssz} from "@chainsafe/lodestar-types";
import {EPOCHS_PER_ETH1_VOTING_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

export function processEth1Data(state: phase0.BeaconState, body: phase0.BeaconBlockBody): void {
  const blockEth1Data = body.eth1Data;
  state.eth1DataVotes.push(blockEth1Data);
  let occurances = 0;
  for (const eth1Data of state.eth1DataVotes) {
    if (ssz.phase0.Eth1Data.equals(blockEth1Data, eth1Data)) {
      occurances++;
    }
  }
  if (occurances * 2 > EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH) {
    state.eth1Data = body.eth1Data;
  }
}
