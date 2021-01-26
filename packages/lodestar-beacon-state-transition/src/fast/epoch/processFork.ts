import {intToBytes} from "@chainsafe/lodestar-utils";
import {IEpochProcess} from "../util/epochProcess";
import {CachedBeaconState} from "../util/cachedBeaconState";

export function processForkChanged(cachedState: CachedBeaconState, process: IEpochProcess): void {
  const config = cachedState.config;
  const currentEpoch = process.currentEpoch;
  const nextEpoch = currentEpoch + 1;
  const currentForkVersion = cachedState.fork.currentVersion;
  const nextFork =
    config.params.ALL_FORKS &&
    config.params.ALL_FORKS.find((fork) =>
      config.types.Version.equals(currentForkVersion, intToBytes(fork.previousVersion, 4))
    );
  if (nextFork && nextFork.epoch === nextEpoch) {
    cachedState.fork = {
      previousVersion: cachedState.fork.currentVersion,
      currentVersion: intToBytes(nextFork.currentVersion, 4),
      epoch: nextFork.epoch,
    };
  }
}
