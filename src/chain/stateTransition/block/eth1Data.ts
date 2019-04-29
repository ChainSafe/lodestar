import {serialize} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  Eth1Data,
} from "../../../types";

import {SLOTS_PER_ETH1_VOTING_PERIOD} from "../../../constants";


export default function processEth1Data(state: BeaconState, block: BeaconBlock): void {
  const blockEth1Data = block.body.eth1Data;
  state.eth1DataVotes.push(blockEth1Data);
  const serializedBlockEth1Data = serialize(blockEth1Data, Eth1Data);
  let occurances = 0;
  state.eth1DataVotes.forEach((eth1Data) => {
    if (serialize(eth1Data, Eth1Data).equals(serializedBlockEth1Data)) {
      occurances++;
    }
  });
  if (occurances * 2 > SLOTS_PER_ETH1_VOTING_PERIOD) {
    state.latestEth1Data = block.body.eth1Data;
  }
}
