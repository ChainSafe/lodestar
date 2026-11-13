import {ChainForkConfig} from "@lodestar/config";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {TimeoutError} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";
import {PayloadError, PayloadErrorCode} from "./importExecutionPayload.js";

/**
 * Verifies that all payload envelope inputs have their data columns available.
 * - Waits a max of one slot duration of the payload's fork for all data to be available
 * - Returns the time at which all data was available
 * - Returns the data availability status for each payload input
 */
export async function verifyPayloadsDataAvailability(
  config: ChainForkConfig,
  payloadInputs: PayloadEnvelopeInput[],
  signal: AbortSignal
): Promise<{
  dataAvailabilityStatuses: DataAvailabilityStatus[];
  availableTime: number;
}> {
  const promises: Promise<gloas.DataColumnSidecar[]>[] = [];
  for (const payloadInput of payloadInputs) {
    if (!payloadInput.hasAllData()) {
      // Sync and reconstruction keep pulling the data columns from the network while we wait
      promises.push(
        payloadInput.waitForAllData(config.getSlotDurationMs(payloadInput.forkName), signal).catch((e) => {
          if (e instanceof TimeoutError) {
            throw new PayloadError(payloadInput, {code: PayloadErrorCode.DATA_UNAVAILABLE});
          }
          throw e;
        })
      );
    }
  }
  await Promise.all(promises);

  const availableTime = Math.max(0, Math.max(...payloadInputs.map((payloadInput) => payloadInput.getTimeComplete())));
  const dataAvailabilityStatuses: DataAvailabilityStatus[] = payloadInputs.map((payloadInput) => {
    if (payloadInput.daOutOfRange) {
      return DataAvailabilityStatus.OutOfRange;
    }
    return payloadInput.getBlobKzgCommitments().length === 0
      ? DataAvailabilityStatus.NotRequired
      : DataAvailabilityStatus.Available;
  });

  return {dataAvailabilityStatuses, availableTime};
}
