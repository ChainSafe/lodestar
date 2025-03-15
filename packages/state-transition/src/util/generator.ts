import {BeaconStateElectra} from "../types";

type LatestBeaconState = BeaconStateElectra;

type BeaconStateIterableKey = Extract<
  keyof LatestBeaconState,
  "pendingDeposits" | "pendingConsolidations" | "pendingPartialWithdrawals"
>;
type BeaconStateIterableType = LatestBeaconState[BeaconStateIterableKey];

export function* pendingDepositIterator(state: BeaconStateElectra, startIndex?: number, chunkSize?: number) {
  yield* iterateBeaconStateIterableInChunks(state.pendingDeposits, startIndex, chunkSize);
}

/**
 * Generator function that abstracts away getReadonlyByRange. Should be a generator version of `getAllReadonly()` but lazy load by chunks
 * @param iterable - An iterable property of the latest beacon state that has `getReadonlyByRange`
 * @param chunkSize - Number of items to retrieve per iteration (default: 100)
 * @param startIndex - Starting index for iteration (default: 0)
 */
function* iterateBeaconStateIterableInChunks(iterable: BeaconStateIterableType, startIndex = 0, chunkSize = 100) {
  const iterableLength = iterable.length;
  let chunkStartIndex = startIndex;

  while (chunkStartIndex < iterableLength) {
    const currentChunk = iterable.getReadonlyByRange(chunkStartIndex, chunkSize);
    for (const element of currentChunk) {
      yield element;
    }
    chunkStartIndex += chunkSize;
  }
}
