import {AbortController} from "abort-controller";
import {source as abortSource} from "abortable-iterator";
import {ResponseErrorCode, ResponseInternalError} from "./errors";

const abortMessage = "TTFB_TIMEOUT_ERROR_MESSAGE";

/**
 * Throws a TTFB_TIMEOUT error if it does not receive any chunk containing
 * one or more bytes after TTFB_TIMEOUT ms from calling this function.
 * Does not transform the byte chunks in any way.
 */
export function ttfbTimeoutController(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  TTFB_TIMEOUT: number,
  signal?: AbortSignal
): (source: AsyncIterable<Buffer>) => AsyncGenerator<Buffer> {
  const controller = new AbortController();

  controller.signal.addEventListener("abort", () => controller.abort());
  signal?.addEventListener("abort", () => controller.abort());

  let responseTimer: NodeJS.Timeout | null = setTimeout(() => {
    controller.abort();
  }, TTFB_TIMEOUT);

  return async function* (source) {
    try {
      for await (const chunk of abortSource(source, controller.signal, {abortMessage})) {
        // Ignore null and empty chunks
        if (responseTimer && chunk && chunk.length > 0) {
          clearTimeout(responseTimer);
          responseTimer = null;
        }

        yield chunk;
      }
    } catch (e) {
      // Rethrow error properly typed so the peer score can pick it up
      if (e.message === abortMessage) {
        throw new ResponseInternalError({code: ResponseErrorCode.TTFB_TIMEOUT});
      } else {
        throw e;
      }
    } finally {
      if (responseTimer) {
        clearTimeout(responseTimer);
      }
    }
  };
}
