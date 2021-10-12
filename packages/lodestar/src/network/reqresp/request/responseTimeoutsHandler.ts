import {AbortController} from "@chainsafe/abort-controller";
import pipe from "it-pipe";
import {timeoutOptions} from "../../../constants";
import {abortableSource} from "../../../util/abortableSource";
import {onChunk} from "../utils";
import {RequestErrorCode, RequestInternalError} from "./errors";

/** Returns the maximum total timeout possible for a response. See @responseTimeoutsHandler */
export function maxTotalResponseTimeout(maxResponses = 1, options?: Partial<typeof timeoutOptions>): number {
  const {TTFB_TIMEOUT, RESP_TIMEOUT} = {...timeoutOptions, ...options};
  return TTFB_TIMEOUT + maxResponses * RESP_TIMEOUT;
}

/**
 * Wraps responseDecoder to isolate the logic that handles response timeouts.
 * - TTFB_TIMEOUT: The requester MUST wait a maximum of TTFB_TIMEOUT for the first response byte to arrive
 * - RESP_TIMEOUT: Requester allows a further RESP_TIMEOUT for each subsequent response_chunk
 */
export function responseTimeoutsHandler<T>(
  responseDecoder: (source: AsyncIterable<Buffer>) => AsyncGenerator<T>,
  options?: Partial<typeof timeoutOptions>
): (source: AsyncIterable<Buffer>) => AsyncGenerator<T> {
  return async function* responseTimeoutsHandlerTransform(source) {
    const {TTFB_TIMEOUT, RESP_TIMEOUT} = {...timeoutOptions, ...options};

    const ttfbTimeoutController = new AbortController();
    const respTimeoutController = new AbortController();

    const timeoutTTFB = setTimeout(() => ttfbTimeoutController.abort(), TTFB_TIMEOUT);
    let timeoutRESP: NodeJS.Timeout | null = null;
    let isFirstByte = true;

    const restartRespTimeout = (): void => {
      if (timeoutRESP) clearTimeout(timeoutRESP);
      timeoutRESP = setTimeout(() => respTimeoutController.abort(), RESP_TIMEOUT);
    };

    try {
      yield* pipe(
        abortableSource(source, [
          {
            signal: ttfbTimeoutController.signal,
            getError: () => new RequestInternalError({code: RequestErrorCode.TTFB_TIMEOUT}),
          },
          {
            signal: respTimeoutController.signal,
            getError: () => new RequestInternalError({code: RequestErrorCode.RESP_TIMEOUT}),
          },
        ]),

        onChunk((bytesChunk) => {
          // Ignore null and empty chunks
          if (isFirstByte && bytesChunk.length > 0) {
            isFirstByte = false;
            // On first byte, cancel the single use TTFB_TIMEOUT, and start RESP_TIMEOUT
            clearTimeout(timeoutTTFB);
            restartRespTimeout();
          }
        }),

        // Transforms `Buffer` chunks to yield `ResponseBody` chunks
        responseDecoder,

        onChunk(() => {
          // On <response_chunk>, cancel this chunk's RESP_TIMEOUT and start next's
          restartRespTimeout();
        })
      );
    } finally {
      clearTimeout(timeoutTTFB);
      if (timeoutRESP !== null) clearTimeout(timeoutRESP);
    }
  };
}
