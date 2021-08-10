import {EPOCHS_PER_ETH1_VOTING_PERIOD} from "@chainsafe/lodestar-params";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {IEpochProcess, CachedBeaconState} from "../util";

/**
 * Reset eth1DataVotes tree every `EPOCHS_PER_ETH1_VOTING_PERIOD`.
 *
 * PERF: Almost no (constant) cost
 */
export function processEth1DataReset(
  state: CachedBeaconState<allForks.BeaconState>,
  epochProcess: IEpochProcess
): void {
  const nextEpoch = epochProcess.currentEpoch + 1;

  // reset eth1 data votes
  if (nextEpoch % EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>;
  }
}
