import {ResponseBody} from "@chainsafe/lodestar-types";

/**
 * Calls `callback` with each `responseChunk` received from the `source` AsyncIterable
 * Does not transform the byte chunks in any way.
 * Useful for logging.
 */
export function onReponseChunk(
  callback: (responseChunk: ResponseBody) => void
): (source: AsyncIterable<ResponseBody>) => AsyncIterable<ResponseBody> {
  return async function* (source) {
    for await (const chunk of source) {
      callback(chunk);
      yield chunk;
    }
  };
}
