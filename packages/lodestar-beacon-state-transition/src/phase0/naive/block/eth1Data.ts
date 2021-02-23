/**
 * @module chain/stateTransition/block
 */

import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function processEth1Data(config: IBeaconConfig, state: phase0.BeaconState, body: phase0.BeaconBlockBody): void {
  const blockEth1Data = body.eth1Data;
  state.eth1DataVotes.push(blockEth1Data);
  let occurances = 0;
  for (const eth1Data of state.eth1DataVotes) {
    if (config.types.phase0.Eth1Data.equals(blockEth1Data, eth1Data)) {
      occurances++;
    }
  }
  if (occurances * 2 > config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * config.params.SLOTS_PER_EPOCH) {
    state.eth1Data = body.eth1Data;
  }
}
