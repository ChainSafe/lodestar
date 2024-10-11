/**
 * Native fetch with transparent and consistent error handling
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/fetch)
 */
async function wrappedFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  try {
    // This function wraps global `fetch` which should only be directly called here
    // biome-ignore lint/style/noRestrictedGlobals: <explanation>
    return await fetch(url, init);
  } catch (e) {
    throw new FetchError(url, e);
  }
}

export {wrappedFetch as fetch};

export function isFetchError(e: unknown): e is FetchError {
  return e instanceof FetchError;
}

export type FetchErrorType = "failed" | "input" | "aborted" | "timeout" | "unknown";

type FetchErrorCause = NativeFetchFailedError["cause"] | NativeFetchInputError["cause"];

export class FetchError extends Error {
  type: FetchErrorType;
  code: string;
  cause?: FetchErrorCause;

  constructor(url: string | URL, e: unknown) {
    if (isNativeFetchFailedError(e)) {
      super(`Request to ${url.toString()} failed, reason: ${e.cause.message}`);
      this.type = "failed";
      this.code = e.cause.code || "ERR_FETCH_FAILED";
      this.cause = e.cause;
    } else if (isNativeFetchInputError(e)) {
      // For input errors the e.message is more detailed
      super(e.message);
      this.type = "input";
      this.code = e.cause.code || "ERR_INVALID_INPUT";
      this.cause = e.cause;
    } else if (isNativeFetchAbortError(e)) {
      super(`Request to ${url.toString()} was aborted`);
      this.type = "aborted";
      this.code = "ERR_ABORTED";
    } else if (isNativeFetchTimeoutError(e)) {
      super(`Request to ${url.toString()} timed out`);
      this.type = "timeout";
      this.code = "ERR_TIMEOUT";
    } else {
      super((e as Error).message);
      this.type = "unknown";
      this.code = "ERR_UNKNOWN";
    }
    this.name = this.constructor.name;
  }
}

type NativeFetchError = TypeError & {
  cause: Error & {
    code?: string;
  };
};

/**
 * ```
 * TypeError: fetch failed
 *   cause: Error: connect ECONNREFUSED 127.0.0.1:9596
 *     errno: -111,
 *     code: 'ECONNREFUSED',
 *     syscall: 'connect',
 *     address: '127.0.0.1',
 *     port: 9596
 * ---------------------------
 * TypeError: fetch failed
 *   cause: Error: getaddrinfo ENOTFOUND non-existent-domain
 *     errno: -3008,
 *     code: 'ENOTFOUND',
 *     syscall: 'getaddrinfo',
 *     hostname: 'non-existent-domain'
 * ---------------------------
 * TypeError: fetch failed
 *   cause: SocketError: other side closed
 *     code: 'UND_ERR_SOCKET',
 *     socket: {}
 * ---------------------------
 * TypeError: fetch failed
 *   cause: Error: unknown scheme
 *     [cause]: undefined
 * ```
 */
type NativeFetchFailedError = NativeFetchError & {
  message: "fetch failed";
  cause: {
    errno?: string;
    syscall?: string;
    address?: string;
    port?: string;
    hostname?: string;
    socket?: object;
    [prop: string]: unknown;
  };
};

/**
 * ```
 * TypeError: Failed to parse URL from invalid-url
 *   [cause]: TypeError [ERR_INVALID_URL]: Invalid URL
 *     input: 'invalid-url',
 *     code: 'ERR_INVALID_URL'
 * ```
 */
type NativeFetchInputError = NativeFetchError & {
  cause: {
    input: unknown;
  };
};

/**
 * ```
 * DOMException [AbortError]: This operation was aborted
 * ```
 */
type NativeFetchAbortError = DOMException & {
  name: "AbortError";
};

/**
 * ```
 * DOMException [TimeoutError]: The operation was aborted due to timeout
 * ```
 */
type NativeFetchTimeoutError = DOMException & {
  name: "TimeoutError";
};

function isNativeFetchError(e: unknown): e is NativeFetchError {
  return e instanceof TypeError && (e as NativeFetchError).cause instanceof Error;
}

function isNativeFetchFailedError(e: unknown): e is NativeFetchFailedError {
  return isNativeFetchError(e) && (e as NativeFetchFailedError).message === "fetch failed";
}

function isNativeFetchInputError(e: unknown): e is NativeFetchInputError {
  return isNativeFetchError(e) && (e as NativeFetchInputError).cause.input !== undefined;
}

function isNativeFetchAbortError(e: unknown): e is NativeFetchAbortError {
  return e instanceof DOMException && (e as NativeFetchAbortError).name === "AbortError";
}

function isNativeFetchTimeoutError(e: unknown): e is NativeFetchTimeoutError {
  return e instanceof DOMException && (e as NativeFetchTimeoutError).name === "TimeoutError";
}
