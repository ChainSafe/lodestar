import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";

export function isDaOutOfRange(
  config: ChainForkConfig,
  forkName: ForkName,
  blockSlot: Slot,
  currentEpoch: Epoch
): boolean {
  if (isForkPostFulu(forkName)) {
    return computeEpochAtSlot(blockSlot) < currentEpoch - config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS;
  }

  if (isForkPostDeneb(forkName)) {
    return computeEpochAtSlot(blockSlot) < currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS;
  }

  return true;
}
