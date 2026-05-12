import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {PayloadEnvelopeInput} from "../seenCache/seenPayloadEnvelopeInput.js";

// we can now wait for full 12 seconds because sync and reconstruction will try pulling
// the data columns from the network anyway while the envelope is being processed
export const PAYLOAD_DATA_AVAILABILITY_TIMEOUT = 12_000;

/**
 * Verifies that all payload envelope inputs have their data columns available.
 * - Waits a max of PAYLOAD_DATA_AVAILABILITY_TIMEOUT for all data to be available
 * - Returns the time at which all data was available
 * - Returns the data availability status for each payload input
 */
export async function verifyPayloadsDataAvailability(
  payloadInputs: PayloadEnvelopeInput[],
  signal: AbortSignal
): Promise<{
  dataAvailabilityStatuses: DataAvailabilityStatus[];
  availableTime: number;
}> {
  const promises: Promise<gloas.DataColumnSidecar[]>[] = [];
  for (const payloadInput of payloadInputs) {
    if (!payloadInput.hasAllData()) {
      promises.push(payloadInput.waitForAllData(PAYLOAD_DATA_AVAILABILITY_TIMEOUT, signal));
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
