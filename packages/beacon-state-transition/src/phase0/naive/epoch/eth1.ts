import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {getCurrentEpoch} from "../../..";

export function processEth1DataReset(config: IBeaconConfig, state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const nextEpoch = currentEpoch + 1;
  // Reset eth1 data votes
  if (nextEpoch % config.params.EPOCHS_PER_ETH1_VOTING_PERIOD === 0) {
    state.eth1DataVotes = ([] as phase0.Eth1Data[]) as List<phase0.Eth1Data>;
  }
}
