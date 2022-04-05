// Uses cross-fetch for browser + NodeJS cross compatibility
// Note: isomorphic-fetch is not well mantained and does not support abort signals
import fetch from "cross-fetch";
import {AbortController, AbortSignal} from "@chainsafe/abort-controller";

import {ErrorAborted, TimeoutError} from "@chainsafe/lodestar-utils";
import {IJson, IRpcPayload, ReqOpts} from "../interface";
import {encodeJwtToken} from "./jwt";
/**
 * Limits the amount of response text printed with RPC or parsing errors
 */
const maxStringLengthToPrint = 500;
const REQUEST_TIMEOUT = 30 * 1000;

interface IRpcResponse<R> extends IRpcResponseError {
  result?: R;
}

interface IRpcResponseError {
  jsonrpc: "2.0";
  id: number;
  error?: {
    code: number; // -32601;
    message: string; // "The method eth_none does not exist/is not available"
  };
}

export interface IJsonRpcHttpClient {
  fetch<R, P = IJson[]>(payload: IRpcPayload<P>, opts?: ReqOpts): Promise<R>;
  fetchBatch<R>(rpcPayloadArr: IRpcPayload[], opts?: ReqOpts): Promise<R[]>;
}

export class JsonRpcHttpClient implements IJsonRpcHttpClient {
  private id = 1;
  /**
   * Optional: If provided, use this jwt secret to HS256 encode and add a jwt token in the
   * request header which can be authenticated by the RPC server to provide access.
   * A fresh token is generated on each requests as EL spec mandates the ELs to check
   * the token freshness +-5 seconds (via `iat` property of the token claim)
   */
  private jwtSecret?: Uint8Array;

  constructor(
    private readonly urls: string[],
    private readonly opts?: {
      signal?: AbortSignal;
      timeout?: number;
      /** If returns true, do not fallback to other urls and throw early */
      shouldNotFallback?: (error: Error) => boolean;
      /**
       * If provided, the requests to the RPC server will be bundled with a HS256 encoded
       * token using this secret. Otherwise the requests to the RPC server will be unauthorized
       * and it might deny responses to the RPC requests.
       */
      jwtSecret?: Uint8Array;
    }
  ) {
    // Sanity check for all URLs to be properly defined. Otherwise it will error in loop on fetch
    if (urls.length === 0) {
      throw Error("No urls provided to JsonRpcHttpClient");
    }
    for (const [i, url] of urls.entries()) {
      if (!url) {
        throw Error(`JsonRpcHttpClient.urls[${i}] is empty or undefined: ${url}`);
      }
    }
    this.jwtSecret = opts?.jwtSecret;
  }

  /**
   * Perform RPC request
   */
  async fetch<R, P = IJson[]>(payload: IRpcPayload<P>, opts?: ReqOpts): Promise<R> {
    const res: IRpcResponse<R> = await this.fetchJson({jsonrpc: "2.0", id: this.id++, ...payload}, opts);
    return parseRpcResponse(res, payload);
  }

  /**
   * Perform RPC batched request
   * Type-wise assumes all requests results have the same type
   */
  async fetchBatch<R>(rpcPayloadArr: IRpcPayload[], opts?: ReqOpts): Promise<R[]> {
    if (rpcPayloadArr.length === 0) return [];

    const resArr: IRpcResponse<R>[] = await this.fetchJson(
      rpcPayloadArr.map(({method, params}) => ({jsonrpc: "2.0", method, params, id: this.id++})),
      opts
    );
    return resArr.map((res, i) => parseRpcResponse(res, rpcPayloadArr[i]));
  }

  private async fetchJson<R, T = unknown>(json: T, opts?: ReqOpts): Promise<R> {
    let lastError: Error | null = null;

    for (const url of this.urls) {
      try {
        return await this.fetchJsonOneUrl(url, json, opts);
      } catch (e) {
        if (this.opts?.shouldNotFallback?.(e as Error)) {
          throw e;
        }

        lastError = e as Error;
      }
    }

    if (lastError !== null) {
      throw lastError;
    } else if (this.urls.length === 0) {
      throw Error("No url provided");
    } else {
      throw Error("Unknown error");
    }
  }

  /**
   * Fetches JSON and throws detailed errors in case the HTTP request is not ok
   */
  private async fetchJsonOneUrl<R, T = unknown>(url: string, json: T, opts?: ReqOpts): Promise<R> {
    // If url is undefined node-fetch throws with `TypeError: Only absolute URLs are supported`
    // Throw a better error instead
    if (!url) throw Error(`Empty or undefined JSON RPC HTTP client url: ${url}`);

    // fetch() throws for network errors:
    // - request to http://missing-url.com/ failed, reason: getaddrinfo ENOTFOUND missing-url.com

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, opts?.timeout ?? this.opts?.timeout ?? REQUEST_TIMEOUT);

    const onParentSignalAbort = (): void => controller.abort();

    if (this.opts?.signal) {
      this.opts.signal.addEventListener("abort", onParentSignalAbort, {once: true});
    }

    try {
      const headers: Record<string, string> = {"Content-Type": "application/json"};
      if (this.jwtSecret) {
        /**
         * ELs have a tight +-5 second freshness check on token's iat i.e. issued at
         * so its better to generate a new token each time. Currently iat is the only claim
         * we are encoding but potentially we can encode more claims.
         * Also currently the algorithm for the token generation is mandated to HS256
         *
         * Jwt auth spec: https://github.com/ethereum/execution-apis/pull/167
         */
        const token = encodeJwtToken({iat: Math.floor(new Date().getTime() / 1000)}, this.jwtSecret);
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        method: "post",
        body: JSON.stringify(json),
        headers,
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timeout);
        this.opts?.signal?.removeEventListener("abort", onParentSignalAbort);
      });

      const body = await res.text();
      if (!res.ok) {
        // Infura errors:
        // - No project ID: Forbidden: {"jsonrpc":"2.0","id":0,"error":{"code":-32600,"message":"project ID is required","data":{"reason":"project ID not provided","see":"https://infura.io/dashboard"}}}
        throw new HttpRpcError(res.status, `${res.statusText}: ${body.slice(0, maxStringLengthToPrint)}`);
      }

      return parseJson(body);
    } catch (e) {
      if (controller.signal.aborted) {
        // controller will abort on both parent signal abort + timeout of this specific request
        if (this.opts?.signal?.aborted) {
          throw new ErrorAborted("request");
        } else {
          throw new TimeoutError("request");
        }
      } else {
        throw e;
      }
    }
  }
}

function parseRpcResponse<R, P>(res: IRpcResponse<R>, payload: IRpcPayload<P>): R {
  if (res.result !== undefined) {
    return res.result;
  } else {
    throw new ErrorJsonRpcResponse(res, payload);
  }
}

/**
 * Util: Parse JSON but display the original source string in case of error
 * Helps debug instances where an API returns a plain text instead of JSON,
 * such as getting an HTML page due to a wrong API URL
 */
function parseJson<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    throw new ErrorParseJson(json, e as Error);
  }
}

export class ErrorParseJson extends Error {
  constructor(json: string, e: Error) {
    super(`Error parsing JSON: ${e.message}\n${json.slice(0, maxStringLengthToPrint)}`);
  }
}

/** JSON RPC endpoint returned status code == 200, but with error property set */
export class ErrorJsonRpcResponse<P> extends Error {
  response: IRpcResponseError;
  payload: IRpcPayload<P>;
  constructor(res: IRpcResponseError, payload: IRpcPayload<P>) {
    const errorMessage = res.error
      ? typeof res.error.message === "string"
        ? res.error.message
        : typeof res.error.code === "number"
        ? parseJsonRpcErrorCode(res.error.code)
        : JSON.stringify(res.error)
      : "no result";

    super(`JSON RPC error: ${errorMessage}, ${payload.method}`);

    this.response = res;
    this.payload = payload;
  }
}

/** JSON RPC endpoint returned status code != 200 */
export class HttpRpcError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * JSON RPC spec errors https://www.jsonrpc.org/specification#response_object
 */
function parseJsonRpcErrorCode(code: number): string {
  if (code === -32700) return "Parse request error";
  if (code === -32600) return "Invalid request object";
  if (code === -32601) return "Method not found";
  if (code === -32602) return "Invalid params";
  if (code === -32603) return "Internal error";
  if (code <= -32000 && code >= -32099) return "Server error";
  return `Unknown error code ${code}`;
}
