import {BeaconConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";

export function computeDataColumnSidecarsAvailabilityStartSlot(
  config: BeaconConfig,
  currentEpoch: Epoch,
  archiveDataEpochs?: number
): Slot {
  if (archiveDataEpochs === Infinity) {
    return computeStartSlotAtEpoch(config.FULU_FORK_EPOCH);
  }

  const dataColumnSidecarsArchiveWindow = Math.max(
    config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS,
    archiveDataEpochs ?? 0
  );
  const dataColumnSidecarsMinEpoch = Math.max(currentEpoch - dataColumnSidecarsArchiveWindow, config.FULU_FORK_EPOCH);

  return computeStartSlotAtEpoch(dataColumnSidecarsMinEpoch);
}
