
import { BeaconStateElectra } from "../types";


type LatestBeaconState = BeaconStateElectra;

type BeaconStateIterableKey = Extract<keyof LatestBeaconState, "pendingDeposits" | "pendingConsolidations" | "pendingPartialWithdrawals">;
type BeaconStateIterableType = LatestBeaconState[BeaconStateIterableKey];


export function* pendingDepositChunkIterator(state: BeaconStateElectra, chunk: number = 100, startIndex: number = 0) {
    yield* iterateBeaconStateIterableInChunks(state.pendingDeposits, chunk, startIndex);
}


/**
 * Generator function that iterates over a chunked range of a BeaconState iterable property.
 * @param iterable - An iterable property of the latest beacon state that has `getReadonlyByRange`
 * @param chunk - Number of items to retrieve per iteration (default: 100)
 * @param startIndex - Starting index for iteration (default: 0)
 */
function* iterateBeaconStateIterableInChunks(iterable: BeaconStateIterableType, chunk: number = 100, startIndex: number = 0): Generator<ReturnType<BeaconStateIterableType["getReadonlyByRange"]>> {
    const iterableLength = iterable.length;
    let chunkStartIndex = startIndex;

    while (chunkStartIndex < iterableLength) {
        yield iterable.getReadonlyByRange(chunkStartIndex, chunk);
        chunkStartIndex += chunk;
    }
}