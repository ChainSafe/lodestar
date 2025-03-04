import {TimeoutError, ErrorAborted} from "@lodestar/utils";

export interface FetchOpts extends RequestInit {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Number of retries */
  retries?: number;
  /** Delay between retries in milliseconds */
  retryDelay?: number;
}

export interface FetchResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

const DEFAULT_TIMEOUT = 60000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * Wrapper around native fetch with additional features:
 * - Timeout
 * - Retries
 * - Consistent error handling
 * - JSON parsing
 */
export async function fetchWithTimeout(
  url: string | URL,
  opts: FetchOpts = {}
): Promise<Response> {
  const {timeout = DEFAULT_TIMEOUT, signal: inputSignal, ...init} = opts;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // If input signal is aborted, abort controller
    if (inputSignal?.aborted) {
      controller.abort();
    }
    
    // Add input signal abort listener
    inputSignal?.addEventListener("abort", () => controller.abort());

    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    return response;

  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      // Check if error was due to timeout or external abort
      if (inputSignal?.aborted) {
        throw new ErrorAborted("request");
      } else {
        throw new TimeoutError("request");
      }
    }
    throw e;

  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch JSON with retries
 */
export async function fetchJson<T>(
  url: string | URL, 
  opts: FetchOpts = {}
): Promise<FetchResponse<T>> {
  const {retries = DEFAULT_RETRIES, retryDelay = DEFAULT_RETRY_DELAY, ...fetchOpts} = opts;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, {
        ...fetchOpts,
        headers: {
          Accept: "application/json",
          ...opts.headers,
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} - ${res.statusText}`);
      }

      return {
        status: res.status,
        body: await res.json(),
        headers: res.headers,
      };

    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }

  // TypeScript control flow
  throw Error("Unreachable");
}

/**
 * Fetch text with retries
 */
export async function fetchText(
  url: string | URL,
  opts: FetchOpts = {}
): Promise<FetchResponse<string>> {
  const {retries = DEFAULT_RETRIES, retryDelay = DEFAULT_RETRY_DELAY, ...fetchOpts} = opts;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, fetchOpts);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} - ${res.statusText}`);
      }

      return {
        status: res.status,
        body: await res.text(),
        headers: res.headers,
      };

    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }

  // TypeScript control flow
  throw Error("Unreachable");
}