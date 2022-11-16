/** The maximum time for complete response transfer. */
export const RESP_TIMEOUT = 10 * 1000; // 10 sec
/** Non-spec timeout from sending request until write stream closed by responder */
export const REQUEST_TIMEOUT = 5 * 1000; // 5 sec
/** The maximum time to wait for first byte of request response (time-to-first-byte). */
export const TTFB_TIMEOUT = 5 * 1000; // 5 sec
/** Non-spec timeout from dialing protocol until stream opened */
export const DIAL_TIMEOUT = 5 * 1000; // 5 sec
// eslint-disable-next-line @typescript-eslint/naming-convention
export const timeoutOptions = {TTFB_TIMEOUT, RESP_TIMEOUT, REQUEST_TIMEOUT, DIAL_TIMEOUT};

export const MAX_VARINT_BYTES = 10;