import {BeaconConfig} from "@lodestar/config";
import {Epoch} from "@lodestar/types";
import {SubscribeBoundary} from "./core/types.js";

export function getSubscribeBoundary(config: BeaconConfig, epoch: Epoch): SubscribeBoundary {
  return {fork: config.getForkInfoAtEpoch(epoch).name};
}
