import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {fetch} from "@lodestar/api";
import {ErrorAborted, Gauge, Histogram, TimeoutError, isValidHttpUrl, retry} from "@lodestar/utils";
import {IJson, RpcPayload} from "../interface.js";
import {JwtClaim, encodeJwtToken} from "./jwt.js";

export enum JsonRpcHttpClientEvent {
  /**
   * When registered this event will be emitted before the client throws an error.
   * This is useful for defining the error behavior in a common place at the time of declaration of the client.
   */
  ERROR = "jsonRpcHttpClient:error",
  /**
   * When registered this event will be emitted before the client returns the valid response to the caller.
   * This is useful for defining some common behavior for each request/response cycle
   */
  RESPONSE = "jsonRpcHttpClient:response",
}

export type JsonRpcHttpClientEvents = {
  [JsonRpcHttpClientEvent.ERROR]: (event: {payload?: unknown; error: Error}) => void;
  [JsonRpcHttpClientEvent.RESPONSE]: (event: {payload?: unknown; response: unknown}) => void;
};

export class JsonRpcHttpClientEventEmitter extends (EventEmitter as {
  new (): StrictEventEmitter<EventEmitter, JsonRpcHttpClientEvents>;
}) {}

/**
 * Limits the amount of response text printed with RPC or parsing errors
 */
const maxStringLengthToPrint = 500;
const REQUEST_TIMEOUT = 30 * 1000;

interface RpcResponse<R> extends RpcResponseError {
  result?: R;
}

interface RpcResponseError {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number; // -32601;
    message: string; // "The method eth_none does not exist/is not available"
  };
}

export type ReqOpts = {
  timeout?: number;
  // To label request metrics
  routeId?: string;
  // retry opts
  retries?: number;
  retryDelay?: number;
  shouldRetry?: (lastError: Error) => boolean;
};

export type JsonRpcHttpClientMetrics = {
  requestTime: Histogram<{routeId: string}>;
  streamTime: Histogram<{routeId: string}>;
  requestErrors: Gauge<{routeId: string}>;
  requestUsedFallbackUrl: Gauge<{routeId: string}>;
  activeRequests: Gauge<{routeId: string}>;
  configUrlsCount: Gauge;
  retryCount: Gauge<{routeId: string}>;
};

export interface IJsonRpcHttpClient {
  fetch<R, P = IJson[]>(payload: RpcPayload<P>, opts?: ReqOpts): Promise<R>;
  fetchWithRetries<R, P = IJson[]>(payload: RpcPayload<P>, opts?: ReqOpts): Promise<R>;
  fetchBatch<R>(rpcPayloadArr: RpcPayload[], opts?: ReqOpts): Promise<R[]>;
  emitter: JsonRpcHttpClientEventEmitter;
}

export class JsonRpcHttpClient implements IJsonRpcHttpClient {
  private id = 1;
  /**
   * Optional: If provided, use this jwt secret to HS256 encode and add a jwt token in the
   * request header which can be authenticated by the RPC server to provide access.
   * A fresh token is generated on each requests as EL spec mandates the ELs to check
   * the token freshness +-5 seconds (via `iat` property of the token claim)
   */
  private readonly jwtSecret?: Uint8Array;
  private readonly jwtId?: string;
  private readonly jwtVersion?: string;
  private readonly metrics: JsonRpcHttpClientMetrics | null;
  readonly emitter = new JsonRpcHttpClientEventEmitter();

  constructor(
    private readonly urls: string[],
    private readonly opts?: {
      signal?: AbortSignal;
      timeout?: number;
      /** If returns true, do not fallback to other urls and throw early */
      shouldNotFallback?: (error: Error) => boolean;
      /**
       * Optional: If provided, use this jwt secret to HS256 encode and add a jwt token in the
       * request header which can be authenticated by the RPC server to provide access.
       * A fresh token is generated on each requests as EL spec mandates the ELs to check
       * the token freshness +-5 seconds (via `iat` property of the token claim)
       *
       * Otherwise the requests to the RPC server will be unauthorized
       * and it might deny responses to the RPC requests.
       */
      jwtSecret?: Uint8Array;
      /** If jwtSecret and jwtId are provided, jwtId will be included in JwtClaim.id */
      jwtId?: string;
      /** If jwtSecret and jwtVersion are provided, jwtVersion will be included in JwtClaim.clv. */
      jwtVersion?: string;
      /** Number of retries per request */
      retries?: number;
      /** Retry delay, only relevant if retries > 0 */
      retryDelay?: number;
      /** Metrics for retry, could be expanded later */
      metrics?: JsonRpcHttpClientMetrics | null;
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
      if (!isValidHttpUrl(url)) {
        throw Error(`JsonRpcHttpClient.urls[${i}] must be a valid URL: ${url}`);
      }
    }

    this.jwtSecret = opts?.jwtSecret;
    this.jwtId = opts?.jwtId;
    this.jwtVersion = opts?.jwtVersion;
    this.metrics = opts?.metrics ?? null;

    this.metrics?.configUrlsCount.set(urls.length);
  }

  /**
   * Perform RPC request
   */
  async fetch<R, P = IJson[]>(payload: RpcPayload<P>, opts?: ReqOpts): Promise<R> {
    return this.wrapWithEvents(
      async () => {
        const res: RpcResponse<R> = await this.fetchJson({jsonrpc: "2.0", id: this.id++, ...payload}, opts);
        return parseRpcResponse(res, payload);
      },
      {payload}
    );
  }

  /**
   * Perform RPC request with retry
   */
  async fetchWithRetries<R, P = IJson[]>(payload: RpcPayload<P>, opts?: ReqOpts): Promise<R> {
    return this.wrapWithEvents(async () => {
      const routeId = opts?.routeId ?? "unknown";

      const res = await retry<RpcResponse<R>>(
        async (_attempt) => {
          return this.fetchJson({jsonrpc: "2.0", id: this.id++, ...payload}, opts);
        },
        {
          retries: opts?.retries ?? this.opts?.retries ?? 0,
          retryDelay: opts?.retryDelay ?? this.opts?.retryDelay,
          shouldRetry: opts?.shouldRetry,
          signal: this.opts?.signal,
          onRetry: () => {
            this.opts?.metrics?.retryCount.inc({routeId});
          },
        }
      );
      return parseRpcResponse(res, payload);
    }, payload);
  }

  /**
   * Perform RPC batched request
   * Type-wise assumes all requests results have the same type
   */
  async fetchBatch<R>(rpcPayloadArr: RpcPayload[], opts?: ReqOpts): Promise<R[]> {
    return this.wrapWithEvents(async () => {
      if (rpcPayloadArr.length === 0) return [];

      const resArr: RpcResponse<R>[] = await this.fetchJson(
        rpcPayloadArr.map(({method, params}) => ({jsonrpc: "2.0", method, params, id: this.id++})),
        opts
      );

      if (!Array.isArray(resArr)) {
        // Nethermind may reply to batch request with a JSON RPC error
        if ((resArr as RpcResponseError).error !== undefined) {
          throw new ErrorJsonRpcResponse(resArr as RpcResponseError, "batch");
        }

        throw Error(`expected array of results, got ${resArr} - ${jsonSerializeTry(resArr)}`);
      }

      return resArr.map((res, i) => parseRpcResponse(res, rpcPayloadArr[i]));
    }, rpcPayloadArr);
  }

  private async wrapWithEvents<T>(func: () => Promise<T>, payload?: unknown): Promise<T> {
    try {
      const response = await func();
      this.emitter.emit(JsonRpcHttpClientEvent.RESPONSE, {payload, response});
      return response;
    } catch (error) {
      this.emitter.emit(JsonRpcHttpClientEvent.ERROR, {payload, error: error as Error});
      throw error;
    }
  }

  private async fetchJson<R, T = unknown>(json: T, opts?: ReqOpts): Promise<R> {
    if (this.urls.length === 0) throw Error("No url provided");

    const routeId = opts?.routeId ?? "unknown";
    let lastError: Error | null = null;

    for (let i = 0; i < this.urls.length; i++) {
      if (i > 0) {
        this.metrics?.requestUsedFallbackUrl.inc({routeId});
      }

      try {
        return await this.fetchJsonOneUrl<R, T>(this.urls[i], json, opts);
      } catch (e) {
        lastError = e as Error;
        if (this.opts?.shouldNotFallback?.(e as Error)) {
          break;
        }
      }
    }
    throw lastError ?? Error("Unknown error");
  }

  /**
   * Fetches JSON and throws detailed errors in case the HTTP request is not ok
   */
  private async fetchJsonOneUrl<R, T = unknown>(url: string, json: T, opts?: ReqOpts): Promise<R> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeout ?? this.opts?.timeout ?? REQUEST_TIMEOUT);

    const onParentSignalAbort = (): void => controller.abort();
    this.opts?.signal?.addEventListener("abort", onParentSignalAbort, {once: true});

    // Default to "unknown" to prevent mixing metrics with others.
    const routeId = opts?.routeId ?? "unknown";
    const timer = this.metrics?.requestTime.startTimer({routeId});
    this.metrics?.activeRequests.inc({routeId}, 1);

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
        const jwtClaim: JwtClaim = {
          iat: Math.floor(Date.now() / 1000),
          id: this.jwtId,
          clv: this.jwtVersion,
        };

        const token = encodeJwtToken(jwtClaim, this.jwtSecret);
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        method: "post",
        body: JSON.stringify(json),
        headers,
        signal: controller.signal,
      });

      const streamTimer = this.metrics?.streamTime.startTimer({routeId});
      const bodyText = await res.text();
      if (!res.ok) {
        // Infura errors:
        // - No project ID: Forbidden: {"jsonrpc":"2.0","id":0,"error":{"code":-32600,"message":"project ID is required","data":{"reason":"project ID not provided","see":"https://infura.io/dashboard"}}}
        throw new HttpRpcError(res.status, `${res.statusText}: ${bodyText.slice(0, maxStringLengthToPrint)}`);
      }

      const bodyJson = parseJson<R>(bodyText);
      streamTimer?.();

      return bodyJson;
    } catch (e) {
      this.metrics?.requestErrors.inc({routeId});
      if (controller.signal.aborted) {
        // controller will abort on both parent signal abort + timeout of this specific request
        if (this.opts?.signal?.aborted) {
          throw new ErrorAborted("request");
        }
        throw new TimeoutError("request");
      }
      throw e;
    } finally {
      timer?.();
      this.metrics?.activeRequests.dec({routeId}, 1);

      clearTimeout(timeout);
      this.opts?.signal?.removeEventListener("abort", onParentSignalAbort);
    }
  }
}

function parseRpcResponse<R, P>(res: RpcResponse<R>, payload: RpcPayload<P>): R {
  if (res.result !== undefined) {
    return res.result;
  }
  if (res.error !== undefined) {
    throw new ErrorJsonRpcResponse(res, payload.method);
  }
  throw Error(`Invalid JSON RPC response, no result or error property: ${jsonSerializeTry(res)}`);
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
export class ErrorJsonRpcResponse extends Error {
  response: RpcResponseError;

  constructor(res: RpcResponseError, payloadMethod: string) {
    const errorMessage =
      typeof res.error === "object"
        ? typeof res.error.message === "string"
          ? res.error.message
          : typeof res.error.code === "number"
            ? parseJsonRpcErrorCode(res.error.code)
            : JSON.stringify(res.error)
        : String(res.error);

    super(`JSON RPC error: ${errorMessage}, ${payloadMethod}`);

    this.response = res;
  }
}

/** JSON RPC endpoint returned status code != 200 */
export class HttpRpcError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
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

function jsonSerializeTry(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return `Unable to serialize ${String(obj)}: ${(e as Error).message}`;
  }
}
