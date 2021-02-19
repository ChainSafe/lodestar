import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {getCurrentEpoch} from "../../../";
import {intToBytes} from "@chainsafe/lodestar-utils";

export function processForkChanged(config: IBeaconConfig, state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const nextEpoch = currentEpoch + 1;
  const currentForkVersion = state.fork.currentVersion;
  const nextFork =
    config.params.ALL_FORKS &&
    config.params.ALL_FORKS.find((fork) =>
      config.types.Version.equals(currentForkVersion, intToBytes(fork.previousVersion, 4))
    );
  if (nextFork && nextFork.epoch === nextEpoch) {
    state.fork = {
      previousVersion: state.fork.currentVersion,
      currentVersion: intToBytes(nextFork.currentVersion, 4),
      epoch: nextFork.epoch,
    };
  }
}
