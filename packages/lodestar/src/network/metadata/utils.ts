import {IBeaconConfig, IForkInfo} from "@chainsafe/lodestar-config";
import {Epoch, phase0} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../constants";
import {IForkDigestContext} from "../../util/forkDigestContext";

export function getENRForkID(
  config: IBeaconConfig,
  forkDigestContext: IForkDigestContext,
  currentEpoch: Epoch
): phase0.ENRForkID {
  const {currentFork, nextFork} = getCurrentAndNextFork(Object.values(config.forks), currentEpoch);

  return {
    // Current fork digest
    forkDigest: forkDigestContext.forkName2ForkDigest(currentFork.name),
    // next planned fork versin
    nextForkVersion: nextFork ? nextFork.version : currentFork.version,
    // next fork epoch
    nextForkEpoch: nextFork ? nextFork.epoch : FAR_FUTURE_EPOCH,
  };
}

function getCurrentAndNextFork(
  forks: IForkInfo[],
  currentEpoch: Epoch
): {currentFork: IForkInfo; nextFork: IForkInfo | undefined} {
  // NOTE: forks must be sorted by descending epoch, latest fork first
  const forksAscending = forks.sort((a, b) => b.epoch - a.epoch);
  // Find the index of the first fork that is over fork epoch
  const currentForkIdx = forksAscending.findIndex((fork) => currentEpoch > fork.epoch);
  const nextForkIdx = currentForkIdx + 1;
  return {
    currentFork: forksAscending[currentForkIdx] || forks[0],
    nextFork: forksAscending[nextForkIdx],
  };
}
