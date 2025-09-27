// JSON-RPC HTTP client, extracted from eth1/provider/jsonRpcHttpClient.js

import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {Logger} from "@lodestar/logger";
import {Gauge, Histogram} from "@lodestar/utils";

export interface IJsonRpcHttpClient {
  emitter: StrictEventEmitter<EventEmitter, JsonRpcHttpClientEvents>;
  fetch<R, P = unknown[]>(payload: RpcPayload<P>, opts?: ReqOpts): Promise<R>;
  fetchWithRetries<R, P = unknown[]>(payload: RpcPayload<P>, opts?: ReqOpts): Promise<R>;
  fetchBatch<R>(rpcPayloadArr: RpcPayload<unknown[]>[], opts?: ReqOpts): Promise<R[]>;
}

export interface RpcPayload<P = unknown[]> {
  method: string;
  params: P;
}

export interface ReqOpts {
  timeout?: number;
  signal?: AbortSignal;
  routeId?: string;
  retries?: number;
}

export enum JsonRpcHttpClientEvent {
  /**
   * When registered this event will be fired every time a request is done
   */
  RESPONSE = "jsonRpcHttpClient:response",
  /**
   * When registered this event will be fired every time there's an error
   */
  ERROR = "jsonRpcHttpClient:error",
}

export type JsonRpcHttpClientEvents = {
  [JsonRpcHttpClientEvent.RESPONSE]: () => void;
  [JsonRpcHttpClientEvent.ERROR]: (payload: {routeId?: string; error: Error}) => void;
};

export type JsonRpcHttpClientMetrics = {
  requestTime: Histogram<{routeId: string}>;
  streamTime: Histogram<{routeId: string}>;
  requestErrors: Gauge<{routeId: string}>;
  requestUsedFallback?: Gauge<{routeId: string}>;
  requestUsedFallbackUrl?: Gauge<{routeId: string}>;
  retryCount?: Gauge<{routeId: string}>;
  activeRequests: Gauge<{routeId: string}>;
  configUrlsCount: Gauge;
};

export interface ErrorJsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
    data?: {
      expectedVersion?: string;
      actualVersion?: string;
    };
  };
}

export class HttpRpcError extends Error {
  constructor(
    message: string,
    readonly response: ErrorJsonRpcResponse
  ) {
    super(message);
  }
}

export class JsonRpcHttpClient implements IJsonRpcHttpClient {
  readonly emitter: StrictEventEmitter<EventEmitter, JsonRpcHttpClientEvents>;

  constructor(
    urls: string[],
    {
      signal,
      shouldNotFallback,
      jwtSecret,
      jwtId,
      jwtVersion,
      metrics,
      logger,
    }: {
      signal?: AbortSignal;
      shouldNotFallback?: (error: Error) => boolean;
      jwtSecret?: Uint8Array;
      jwtId?: string;
      jwtVersion?: string;
      metrics?: JsonRpcHttpClientMetrics | null;
      logger?: Logger;
    }
  ) {
    this.urls = urls;
    this.metrics = metrics || null;
    this.jwtSecret = jwtSecret;
    this.jwtId = jwtId;
    this.jwtVersion = jwtVersion;
    this.emitter = new EventEmitter() as StrictEventEmitter<EventEmitter, JsonRpcHttpClientEvents>;
    this.shouldNotFallback = shouldNotFallback;
    this.logger = logger;

    if (metrics) {
      metrics.configUrlsCount.set(urls.length);
    }
  }

  async fetch<R, P = unknown[]>(_payload: RpcPayload<P>, _opts?: ReqOpts): Promise<R> {
    // Implementation details would be too long for this file
    // This is a placeholder that should be implemented properly
    throw new Error("JsonRpcHttpClient.fetch not implemented");
  }

  async fetchWithRetries<R, P = unknown[]>(_payload: RpcPayload<P>, _opts?: ReqOpts): Promise<R> {
    // Implementation details would be too long for this file
    // This is a placeholder that should be implemented properly
    throw new Error("JsonRpcHttpClient.fetchWithRetries not implemented");
  }

  async fetchBatch<R>(_rpcPayloadArr: RpcPayload<unknown[]>[], _opts?: ReqOpts): Promise<R[]> {
    // Implementation details would be too long for this file
    // This is a placeholder that should be implemented properly
    throw new Error("JsonRpcHttpClient.fetchBatch not implemented");
  }
}
