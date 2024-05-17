// Default spec values from https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#configuration
export const DEFAULT_DIAL_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_REQUEST_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_TTFB_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_RESP_TIMEOUT = 10 * 1000; // 10 sec

export const DEFAULT_TIMEOUTS = {
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT,
  dialTimeoutMs: DEFAULT_DIAL_TIMEOUT,
  ttfbTimeoutMs: DEFAULT_TTFB_TIMEOUT,
  respTimeoutMs: DEFAULT_RESP_TIMEOUT,
};
