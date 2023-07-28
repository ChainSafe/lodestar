/**
 * Wrapper around native fetch to improve error handling
 */
async function wrappedFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new FetchError(e, url);
  }
}

export {wrappedFetch as fetch};

export function isFetchError(e: unknown): e is FetchError {
  return e instanceof FetchError;
}

export function isFetchAbortError(e: unknown): e is FetchError {
  return e instanceof FetchError && e.type === "aborted";
}

export type FetchErrorType = "system" | "input" | "aborted" | "other" | "unknown";

export type FetchErrorCause = NativeFetchError["cause"];

export class FetchError extends Error {
  type: FetchErrorType;
  code: string;
  cause?: FetchErrorCause;

  constructor(e: unknown, url: string | URL) {
    if (isNativeSystemFetchError(e)) {
      super(`Request to ${url.toString()} failed, reason: ${e.cause.message}`);
      this.type = "system";
      this.code = e.cause.code;
      this.cause = e.cause;
    } else if (isNativeFetchInputError(e)) {
      super(e.message);
      this.type = "input";
      this.code = e.cause.code;
      this.cause = e.cause;
    } else if (isNativeFetchAbortError(e)) {
      super(`Request to ${url.toString()} was aborted`);
      this.type = "aborted";
      this.code = "ERR_ABORTED";
    } else if (isNativeFetchError(e)) {
      super(`Request to ${url.toString()} failed, reason: ${e.cause.message}`);
      this.type = "other";
      this.code = e.cause.code;
      this.cause = e.cause;
    } else {
      super((e as Error).message);
      this.type = "unknown";
      this.code = "ERR_UNKNOWN";
    }
    this.name = this.constructor.name;
  }
}

/**
 * ```
 * TypeError: fetch failed
 *   cause: Error: more detailed message
 *     code: 'ERROR_CODE'
 * ```
 */
type NativeFetchError = Error & {
  cause: Error & {
    code: string;
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
 *
 * TypeError: fetch failed
 *   cause: Error: getaddrinfo ENOTFOUND non-existent-domain
 *     errno: -3008,
 *     code: 'ENOTFOUND',
 *     syscall: 'getaddrinfo',
 *     hostname: 'non-existent-domain'
 * ```
 */
type NativeFetchSystemError = NativeFetchError & {
  cause: {
    errno: string;
    syscall: string;
    address?: string;
    port?: string;
    hostname?: string;
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

function isNativeFetchError(e: unknown): e is NativeFetchError {
  return (
    e instanceof Error &&
    (e as NativeFetchError).cause instanceof Error &&
    (e as NativeFetchError).cause.code !== undefined
  );
}

function isNativeSystemFetchError(e: unknown): e is NativeFetchSystemError {
  return isNativeFetchError(e) && (e as NativeFetchSystemError).cause.syscall !== undefined;
}

function isNativeFetchInputError(e: unknown): e is NativeFetchInputError {
  return isNativeFetchError(e) && (e as NativeFetchInputError).cause.input !== undefined;
}

function isNativeFetchAbortError(e: unknown): e is NativeFetchAbortError {
  return e instanceof DOMException && e.name === "AbortError";
}
