import {AbortController} from "abort-controller";
import {source as abortSource, Signals} from "abortable-iterator";
import pipe from "it-pipe";
import {timeoutOptions} from "../../../constants";
import {onChunk} from "../utils/onChunk";
import {ResponseErrorCode, ResponseInternalError} from "./errors";

/**
 * Wraps responseDecoder to isolate the logic that handles response timeouts.
 * - TTFB_TIMEOUT: The requester MUST wait a maximum of TTFB_TIMEOUT for the first response byte to arrive
 * - RESP_TIMEOUT: Requester allows a further RESP_TIMEOUT for each subsequent response_chunk
 */
export function responseTimeoutsHandler<T>(
  responseDecoder: (source: AsyncIterable<Buffer>) => AsyncGenerator<T>,
  options?: Partial<typeof timeoutOptions>
): (source: AsyncIterable<Buffer>) => AsyncGenerator<T> {
  return async function* (source) {
    const {TTFB_TIMEOUT, RESP_TIMEOUT} = {...timeoutOptions, ...options};

    const ttfbTimeoutController = new AbortController();
    const respTimeoutController = new AbortController();

    const timeoutTTFB = setTimeout(() => ttfbTimeoutController.abort(), TTFB_TIMEOUT);
    let timeoutRESP: NodeJS.Timeout | null = null;

    try {
      yield* pipe(
        abortSource(source, [
          {abortMessage: ResponseErrorCode.TTFB_TIMEOUT, signal: ttfbTimeoutController.signal},
          {abortMessage: ResponseErrorCode.RESP_TIMEOUT, signal: respTimeoutController.signal},
        ] as Signals<Buffer>),
        onChunk((bytesChunk) => {
          // Ignore null and empty chunks
          if (bytesChunk.length === 0) return;
          // On first byte, cancel the single use TTFB_TIMEOUT
          clearTimeout(timeoutTTFB);
          // Start the RESP_TIMEOUT at the begining of a <response_chunk>
          if (!timeoutRESP) timeoutRESP = setTimeout(() => respTimeoutController.abort(), RESP_TIMEOUT);
        }),

        responseDecoder,
        onChunk(() => {
          // On <response_chunk>, cancel this chunk's RESP_TIMEOUT
          if (timeoutRESP) clearTimeout(timeoutRESP);
          timeoutRESP = null;
        })
      );
    } catch (e) {
      // Rethrow error properly typed so the peer score can pick it up
      switch (e.message) {
        case ResponseErrorCode.TTFB_TIMEOUT:
          throw new ResponseInternalError({code: ResponseErrorCode.TTFB_TIMEOUT});
        case ResponseErrorCode.RESP_TIMEOUT:
          throw new ResponseInternalError({code: ResponseErrorCode.RESP_TIMEOUT});
        default:
          throw e;
      }
    } finally {
      clearTimeout(timeoutTTFB);
      if (timeoutRESP) clearTimeout(timeoutRESP);
    }
  };
}
