import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, phase0} from "@chainsafe/lodestar-types";
import {FAR_FUTURE_EPOCH} from "../../constants";
import {IForkDigestContext} from "../../util/forkDigestContext";
import {getCurrentAndNextFork} from "../util";

export function getENRForkID(
  config: IBeaconConfig,
  forkDigestContext: IForkDigestContext,
  epoch: Epoch
): phase0.ENRForkID {
  const {currentFork, nextFork} = getCurrentAndNextFork(config, epoch);

  return {
    // Current fork digest
    forkDigest: forkDigestContext.forkName2ForkDigest(currentFork.name),
    // next planned fork versin
    nextForkVersion: nextFork ? nextFork.version : currentFork.version,
    // next fork epoch
    nextForkEpoch: nextFork ? nextFork.epoch : FAR_FUTURE_EPOCH,
  };
}
