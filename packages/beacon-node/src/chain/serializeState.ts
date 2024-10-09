import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {AllocSource, BufferPool} from "../util/bufferPool.js";

type ProcessStateBytesFn<T> = (stateBytes: Uint8Array) => Promise<T>;

/*
 * Serialize state using the BufferPool if provided.
 */
export async function serializeState<T>(
  state: CachedBeaconStateAllForks,
  source: AllocSource,
  processFn: ProcessStateBytesFn<T>,
  bufferPool?: BufferPool | null
): Promise<T> {
  const size = state.type.tree_serializedSize(state.node);
  let stateBytes: Uint8Array | null = null;
  if (bufferPool) {
    using bufferWithKey = bufferPool.alloc(size, source);
    if (bufferWithKey) {
      stateBytes = bufferWithKey.buffer;
      const dataView = new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
      state.serializeToBytes({uint8Array: stateBytes, dataView}, 0);
      return processFn(stateBytes);
    }
    // release the buffer back to the pool automatically
  }

  // we already have metrics in BufferPool so no need to do it here
  stateBytes = state.serialize();

  return processFn(stateBytes);
}
