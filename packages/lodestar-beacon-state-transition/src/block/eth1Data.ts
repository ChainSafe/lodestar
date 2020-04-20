/**
 * @module chain/stateTransition/block
 */

import {BeaconBlockBody, BeaconState,} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function processEth1Data(
  config: IBeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody
): void {
  const blockEth1Data = body.eth1Data;
  state.eth1DataVotes.push(blockEth1Data);
  let occurances = 0;
  state.eth1DataVotes.forEach((eth1Data) => {
    if (config.types.Eth1Data.equals(blockEth1Data, eth1Data)) {
      occurances++;
    }
  });
  if (occurances * 2 > config.params.EPOCHS_PER_ETH1_VOTING_PERIOD * config.params.SLOTS_PER_EPOCH) {
    state.eth1Data = body.eth1Data;
  }
}
