import {EPOCHS_PER_ETH1_VOTING_PERIOD} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {getCurrentEpoch} from "../../../util";

export function processEth1DataReset(state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const nextEpoch = currentEpoch + 1;
  // Reset eth1 data votes
  if (nextEpoch % EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>;
  }
}
