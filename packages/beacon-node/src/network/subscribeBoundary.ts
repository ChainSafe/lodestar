import {BlobScheduleEntry, ForkConfig, ForkInfo} from "@lodestar/config";
import {isForkPostFulu} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {SubscribeBoundary} from "./core/types.js";

export function getSubscribeBoundary(config: ForkConfig, epoch: Epoch): SubscribeBoundary {
  const fork = config.getForkInfoAtEpoch(epoch).name;

  if (isForkPostFulu(fork)) {
    const blobSchedule = config.getBlobParameters(epoch);
    return {...blobSchedule, fork};
  }

  return {fork};
}

export function isBlobScheduleSubscribeBoundary(
  forkBlobSchedule: ForkInfo | BlobScheduleEntry
): forkBlobSchedule is BlobScheduleEntry {
  return "EPOCH" in forkBlobSchedule;
}
