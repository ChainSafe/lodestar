import {BeaconState} from "@chainsafe/lodestar-types";
import {EpochContext} from "..";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {IEpochProcess} from "../util";

export function processForkChanged(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: BeaconState): void {
  const config = epochCtx.config;
  const currentEpoch = process.currentEpoch;
  const nextEpoch = currentEpoch + 1;
  const currentForkVersion = state.fork.currentVersion;
  const nextFork = config.params.ALL_FORKS && config.params.ALL_FORKS.find(
    (fork) => config.types.Version.equals(currentForkVersion, intToBytes(fork.previousVersion, 4)));
  if (nextFork && nextFork.epoch === nextEpoch) {
    state.fork = {
      previousVersion: state.fork.currentVersion,
      currentVersion: intToBytes(nextFork.currentVersion, 4),
      epoch: nextFork.epoch,
    };
  }
}