import {BeaconConfig, BlobScheduleEntry} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {SubscribeBoundary} from "./core/types.js";

export function getSubscribeBoundary(config: BeaconConfig, epoch: Epoch): SubscribeBoundary {
  const fork = config.getForkInfoAtEpoch(epoch).name;
  const blobSchedule = config.getBlobParameters(epoch);
  return blobSchedule !== null ? {...blobSchedule, fork} : {fork: config.getForkInfoAtEpoch(epoch).name};
}

export function isBlobScheduleBoundary(boundary: SubscribeBoundary): boundary is BlobScheduleEntry & {fork: ForkName} {
  return (boundary as BlobScheduleEntry & {fork: ForkName}).MAX_BLOBS_PER_BLOCK !== undefined;
}
