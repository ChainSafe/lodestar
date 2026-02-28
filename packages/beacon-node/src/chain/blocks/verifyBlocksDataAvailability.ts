import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {DAData, DAType, IBlockInput} from "./blockInput/index.js";

// We can now wait for full slot duration because unavailable block sync will try pulling
// the blobs from the network anyway after 500ms of seeing the block.
// Pre-EIP7782: 12s (full slot). Post-EIP7782: 6s (full slot at new duration).
// Using 12s as safe upper bound — blocks arriving late post-fork will still resolve within a slot.
export const BLOB_AVAILABILITY_TIMEOUT = 12_000;

/**
 * Verifies that all block inputs have data available.
 * - Waits a max of BLOB_AVAILABILITY_TIMEOUT for all data to be available
 * - Returns the time at which all data was available
 * - Returns the data availability status for each block input
 */
export async function verifyBlocksDataAvailability(
  blocks: IBlockInput[],
  signal: AbortSignal
): Promise<{
  dataAvailabilityStatuses: DataAvailabilityStatus[];
  availableTime: number;
}> {
  const promises: Promise<DAData>[] = [];
  for (const blockInput of blocks) {
    // block verification is triggered on a verified gossip block so we only need to wait for all data
    if (!blockInput.hasAllData()) {
      promises.push(blockInput.waitForAllData(BLOB_AVAILABILITY_TIMEOUT, signal));
    }
  }
  await Promise.all(promises);

  const availableTime = Math.max(0, Math.max(...blocks.map((blockInput) => blockInput.getTimeComplete())));
  const dataAvailabilityStatuses: DataAvailabilityStatus[] = blocks.map((blockInput) => {
    if (blockInput.type === DAType.NoData) {
      return DataAvailabilityStatus.NotRequired;
    }
    if (blockInput.type === DAType.PreData) {
      return DataAvailabilityStatus.PreData;
    }
    if (blockInput.daOutOfRange) {
      return DataAvailabilityStatus.OutOfRange;
    }
    return DataAvailabilityStatus.Available;
  });

  return {dataAvailabilityStatuses, availableTime};
}
