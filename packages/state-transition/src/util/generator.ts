import { CompositeViewDU, ListCompositeTreeViewDU } from "@chainsafe/ssz";
import {BeaconStateElectra} from "../types";

type LatestBeaconState = BeaconStateElectra;

type BeaconStateIterableKey = Extract<
  keyof LatestBeaconState,
  "pendingDeposits" | "pendingConsolidations" | "pendingPartialWithdrawals"
>;
type BeaconStateIterableType = LatestBeaconState[BeaconStateIterableKey];

type ElementType = LatestBeaconState[BeaconStateIterableKey] extends ListCompositeTreeViewDU<infer T> ? T : never;
type DepositType = LatestBeaconState[Extract<BeaconStateIterableKey, "pendingDeposits">] extends ListCompositeTreeViewDU<infer T> ? T : never;

export function* pendingDepositIterator(state: BeaconStateElectra, startIndex?: number, chunkSize?: number): Generator<CompositeViewDU<DepositType>> {
  for (const deposit of iterateBeaconStateIterableInChunks(state.pendingDeposits, startIndex, chunkSize)) {
    yield deposit as CompositeViewDU<DepositType>;
  }
}

/**
 * Generator function that abstracts away getReadonlyByRange. Should be a generator version of `getAllReadonly()` but lazy load by chunks
 * @param iterable - An iterable property of the latest beacon state that has `getReadonlyByRange`
 * @param chunkSize - Number of items to retrieve per iteration (default: 100)
 * @param startIndex - Starting index for iteration (default: 0)
 */
function* iterateBeaconStateIterableInChunks(iterable: BeaconStateIterableType, startIndex = 0, chunkSize = 100): Generator<CompositeViewDU<ElementType>> {
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
