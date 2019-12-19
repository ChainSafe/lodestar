/**
 * @module chain/stateTransition/block
 */

import {equals} from "@chainsafe/ssz";

import {BeaconBlockBody, BeaconState,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#eth1-data

export function processEth1Data(
  config: IBeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody
): void {
  const blockEth1Data = body.eth1Data;
  state.eth1DataVotes.push(blockEth1Data);
  let occurances = 0;
  state.eth1DataVotes.forEach((eth1Data) => {
    if (equals(config.types.Eth1Data, blockEth1Data, eth1Data)) {
      occurances++;
    }
  });
  if (occurances * 2 > config.params.SLOTS_PER_ETH1_VOTING_PERIOD) {
    state.eth1Data = body.eth1Data;
  }
}
