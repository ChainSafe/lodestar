/**
 * Calls `callback` with each `chunk` received from the `source` AsyncIterable
 * Useful for logging, or cancelling timeouts
 */
export function onChunk<T>(callback: (chunk: T) => void): (source: AsyncIterable<T>) => AsyncIterable<T> {
  return async function* onChunkTransform(source) {
    for await (const chunk of source) {
      callback(chunk);
      yield chunk;
    }
  };
}
