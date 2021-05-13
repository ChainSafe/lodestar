import {allForks, phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processEth1DataReset(state: CachedBeaconState<allForks.BeaconState>, process: IEpochProcess): void {
  const nextEpoch = process.currentEpoch + 1;
  const {EPOCHS_PER_ETH1_VOTING_PERIOD} = state.config.params;

  // reset eth1 data votes
  if (nextEpoch % EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>;
  }
}
