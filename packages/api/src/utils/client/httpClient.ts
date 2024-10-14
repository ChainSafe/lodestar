import {ErrorAborted, Logger, MapDef, TimeoutError, isValidHttpUrl, retry, toPrintableUrl} from "@lodestar/utils";
import {mergeHeaders} from "../headers.js";
import {Endpoint} from "../types.js";
import {WireFormat} from "../wireFormat.js";
import {HttpStatusCode} from "../httpStatusCode.js";
import {
  ApiRequestInit,
  ApiRequestInitRequired,
  ExtraRequestInit,
  RouteDefinitionExtra,
  UrlInit,
  UrlInitRequired,
  createApiRequest,
} from "./request.js";
import {ApiResponse} from "./response.js";
import {Metrics} from "./metrics.js";
import {fetch, isFetchError} from "./fetch.js";

/** A higher default timeout, validator will set its own shorter timeoutMs */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 200;
/**
 * Default to JSON to ensure compatibility with other clients, can be overridden
 * per route in case spec states that SSZ requests must be supported by server.
 * Alternatively, can be configured via CLI flag to use SSZ for all routes.
 */
const DEFAULT_REQUEST_WIRE_FORMAT = WireFormat.json;
/**
 * For responses, it is possible to default to SSZ without breaking compatibility with
 * other clients as we will just be stating a preference to receive a SSZ response from
 * the server but will still accept a JSON response in case the server does not support it.
 */
const DEFAULT_RESPONSE_WIRE_FORMAT = WireFormat.ssz;

const URL_SCORE_DELTA_SUCCESS = 1;
/** Require 2 success to recover from 1 failed request */
const URL_SCORE_DELTA_ERROR = 2 * URL_SCORE_DELTA_SUCCESS;
/** In case of continued errors, require 10 success to mark the URL as healthy */
const URL_SCORE_MAX = 10 * URL_SCORE_DELTA_SUCCESS;
const URL_SCORE_MIN = 0;

export const defaultInit: Required<ExtraRequestInit> = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retries: DEFAULT_RETRIES,
  retryDelay: DEFAULT_RETRY_DELAY,
  requestWireFormat: DEFAULT_REQUEST_WIRE_FORMAT,
  responseWireFormat: DEFAULT_RESPONSE_WIRE_FORMAT,
};

export interface IHttpClient {
  readonly baseUrl: string;
  readonly urlsInits: UrlInitRequired[];
  readonly urlsScore: number[];

  request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit?: ApiRequestInit
  ): Promise<ApiResponse<E>>;
}

export type HttpClientOptions = ({baseUrl: string} | {urls: (string | UrlInit)[]}) & {
  globalInit?: ApiRequestInit;
  /** Override fetch function */
  fetch?: typeof fetch;
};

export type HttpClientModules = {
  logger?: Logger;
  metrics?: Metrics;
};

export class HttpClient implements IHttpClient {
  readonly urlsInits: UrlInitRequired[] = [];
  readonly urlsScore: number[];

  private readonly signal: null | AbortSignal;
  private readonly fetch: typeof fetch;
  private readonly metrics: null | Metrics;
  private readonly logger: null | Logger;

  /**
   * Cache to keep track of routes per server that do not support SSZ. This cache will only be
   * populated if we receive a 415 error response from the server after sending a SSZ request body.
   * The request will be retried using a JSON body and all subsequent requests will only use JSON.
   */
  private readonly sszNotSupportedByRouteIdByUrlIndex = new MapDef<number, Map<string, boolean>>(() => new Map());

  get baseUrl(): string {
    return this.urlsInits[0].baseUrl;
  }

  constructor(opts: HttpClientOptions, {logger, metrics}: HttpClientModules = {}) {
    // Cast to all types optional since they are defined with syntax `HttpClientOptions = A | B`
    const {baseUrl, urls = []} = opts as {baseUrl?: string; urls?: (string | UrlInit)[]};
    // Do not merge global signal into url inits
    const {signal, ...globalInit} = opts.globalInit ?? {};

    // opts.baseUrl is equivalent to `urls: [{baseUrl}]`
    // unshift opts.baseUrl to urls, without mutating opts.urls
    for (const [i, urlOrInit] of [...(baseUrl ? [baseUrl] : []), ...urls].entries()) {
      const init = typeof urlOrInit === "string" ? {baseUrl: urlOrInit} : urlOrInit;
      const urlInit: UrlInit = {
        ...globalInit,
        ...init,
        headers: mergeHeaders(globalInit.headers, init.headers),
      };

      if (!urlInit.baseUrl) {
        throw Error(`HttpClient.urls[${i}] is empty or undefined: ${urlInit.baseUrl}`);
      }
      if (!isValidHttpUrl(urlInit.baseUrl)) {
        throw Error(`HttpClient.urls[${i}] must be a valid URL: ${urlInit.baseUrl}`);
      }
      // De-duplicate by baseUrl, having two baseUrls with different token or timeouts does not make sense
      if (!this.urlsInits.some((opt) => opt.baseUrl === urlInit.baseUrl)) {
        this.urlsInits.push({
          ...urlInit,
          baseUrl: urlInit.baseUrl,
          urlIndex: i,
          printableUrl: toPrintableUrl(urlInit.baseUrl),
        });
      }
    }

    if (this.urlsInits.length === 0) {
      throw Error("Must set at least 1 URL in HttpClient opts");
    }

    // Initialize scores to max value to only query first URL on start
    this.urlsScore = this.urlsInits.map(() => URL_SCORE_MAX);

    this.signal = signal ?? null;
    this.fetch = opts.fetch ?? fetch;
    this.metrics = metrics ?? null;
    this.logger = logger ?? null;

    if (metrics) {
      metrics.urlsScore.addCollect(() => {
        for (let i = 0; i < this.urlsScore.length; i++) {
          metrics.urlsScore.set({urlIndex: i, baseUrl: this.urlsInits[i].printableUrl}, this.urlsScore[i]);
        }
      });
    }
  }

  async request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit = {}
  ): Promise<ApiResponse<E>> {
    if (this.urlsInits.length === 1) {
      const init = mergeInits(definition, this.urlsInits[0], localInit);

      if (init.retries > 0) {
        return this.requestWithRetries(definition, args, init);
      }
      return this.getRequestMethod(init)(definition, args, init);
    }
    return this.requestWithFallbacks(definition, args, localInit);
  }

  /**
   * Send request to primary server first, retry failed requests on fallbacks
   */
  private async requestWithFallbacks<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit
  ): Promise<ApiResponse<E>> {
    let i = 0;

    // Goals:
    // - if first server is stable and responding do not query fallbacks
    // - if first server errors, retry that same request on fallbacks
    // - until first server is shown to be reliable again, contact all servers

    // First loop: retry in sequence, query next URL only after previous errors
    for (; i < this.urlsInits.length; i++) {
      try {
        const res = await new Promise<ApiResponse<E>>((resolve, reject) => {
          let requestCount = 0;
          let errorCount = 0;

          // Second loop: query all URLs up to the next healthy at once, racing them.
          // Score each URL available:
          // - If url[0] is good, only send to 0
          // - If url[0] has recently errored, send to both 0, 1, etc until url[0] does not error for some time
          for (; i < this.urlsInits.length; i++) {
            const {printableUrl} = this.urlsInits[i];
            const routeId = definition.operationId;

            if (i > 0) {
              this.metrics?.requestToFallbacks.inc({routeId, baseUrl: printableUrl});
              this.logger?.debug("Requesting fallback URL", {routeId, baseUrl: printableUrl, score: this.urlsScore[i]});
            }

            const i_ = i; // Keep local copy of i variable to index urlScore after requestWithBody() resolves

            const urlInit = this.urlsInits[i];
            if (urlInit === undefined) {
              throw Error(`Url at index ${i} does not exist`);
            }
            const init = mergeInits(definition, urlInit, localInit);

            const requestMethod = init.retries > 0 ? this.requestWithRetries.bind(this) : this.getRequestMethod(init);

            requestMethod(definition, args, init).then(
              async (res) => {
                if (res.ok) {
                  this.urlsScore[i_] = Math.min(URL_SCORE_MAX, this.urlsScore[i_] + URL_SCORE_DELTA_SUCCESS);
                  // Resolve immediately on success
                  resolve(res);
                } else {
                  this.urlsScore[i_] = Math.max(URL_SCORE_MIN, this.urlsScore[i_] - URL_SCORE_DELTA_ERROR);

                  // Resolve failed response only when all queried URLs have errored
                  if (++errorCount >= requestCount) {
                    resolve(res);
                  } else {
                    this.logger?.debug(
                      "Request error, retrying",
                      {routeId, baseUrl: printableUrl},
                      res.error() as Error
                    );
                  }
                }
              },
              (err) => {
                this.urlsScore[i_] = Math.max(URL_SCORE_MIN, this.urlsScore[i_] - URL_SCORE_DELTA_ERROR);

                // Reject only when all queried URLs have errored
                // TODO: Currently rejects with last error only, should join errors?
                if (++errorCount >= requestCount) {
                  reject(err);
                } else {
                  this.logger?.debug("Request error, retrying", {routeId, baseUrl: printableUrl}, err);
                }
              }
            );

            requestCount++;

            // Do not query URLs after a healthy URL
            if (this.urlsScore[i] >= URL_SCORE_MAX) {
              break;
            }
          }
        });
        if (res.ok) {
          return res;
        }
        if (i >= this.urlsInits.length - 1) {
          return res;
        }
        this.logger?.debug("Request error, retrying", {}, res.error() as Error);
      } catch (e) {
        if (i >= this.urlsInits.length - 1) {
          throw e;
        }
        this.logger?.debug("Request error, retrying", {}, e as Error);
      }
    }

    throw Error("loop ended without return or rejection");
  }

  /**
   * Send request to single URL, retry failed requests on same server
   */
  private async requestWithRetries<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    init: ApiRequestInitRequired
  ): Promise<ApiResponse<E>> {
    const {retries, retryDelay, signal} = init;
    const routeId = definition.operationId;
    const requestMethod = this.getRequestMethod(init);

    return retry(
      async (attempt) => {
        const res = await requestMethod(definition, args, init);
        if (!res.ok && attempt <= retries) {
          throw res.error();
        }
        return res;
      },
      {
        retries,
        retryDelay,
        // Local signal takes precedence over global signal
        signal: signal ?? this.signal ?? undefined,
        onRetry: (e, attempt) => {
          this.logger?.debug("Retrying request", {routeId, attempt, lastError: e.message});
        },
      }
    );
  }

  /**
   * Send request to single URL, SSZ requests will be retried using JSON
   * if a 415 error response is returned by the server. All subsequent requests
   * to this server for the route will always be sent as JSON afterwards.
   */
  private async requestFallbackToJson<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    init: ApiRequestInitRequired
  ): Promise<ApiResponse<E>> {
    const {urlIndex} = init;
    const routeId = definition.operationId;

    const sszNotSupportedByRouteId = this.sszNotSupportedByRouteIdByUrlIndex.getOrDefault(urlIndex);
    if (sszNotSupportedByRouteId.has(routeId)) {
      init.requestWireFormat = WireFormat.json;
    }

    const res = await this._request(definition, args, init);

    if (res.status === HttpStatusCode.UNSUPPORTED_MEDIA_TYPE && init.requestWireFormat === WireFormat.ssz) {
      this.logger?.debug("SSZ request failed with status 415, retrying using JSON", {routeId, urlIndex});

      sszNotSupportedByRouteId.set(routeId, true);
      init.requestWireFormat = WireFormat.json;

      return this._request(definition, args, init);
    }

    return res;
  }

  /**
   * Send request to single URL
   */
  private async _request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    init: ApiRequestInitRequired
  ): Promise<ApiResponse<E>> {
    const abortSignals = [this.signal, init.signal];

    // Implement fetch timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
    init.signal = controller.signal;

    // Attach global/local signal to this request's controller
    const onSignalAbort = (): void => controller.abort();
    for (const s of abortSignals) {
      s?.addEventListener("abort", onSignalAbort);
    }

    const routeId = definition.operationId;
    const {printableUrl, requestWireFormat, responseWireFormat} = init;
    const timer = this.metrics?.requestTime.startTimer({routeId});

    try {
      this.logger?.debug("API request", {routeId, requestWireFormat, responseWireFormat});
      const request = createApiRequest(definition, args, init);
      const response = await this.fetch(request.url, request);
      const apiResponse = new ApiResponse(definition, response.body, response);

      if (!apiResponse.ok) {
        await apiResponse.errorBody();
        this.logger?.debug("API response error", {routeId, status: apiResponse.status});
        this.metrics?.requestErrors.inc({routeId, baseUrl: printableUrl});
        return apiResponse;
      }

      const streamTimer = this.metrics?.streamTime.startTimer({routeId});
      try {
        await apiResponse.rawBody();
        this.logger?.debug("API response success", {
          routeId,
          status: apiResponse.status,
          wireFormat: apiResponse.wireFormat(),
        });
        return apiResponse;
      } finally {
        streamTimer?.();
      }
    } catch (e) {
      this.metrics?.requestErrors.inc({routeId, baseUrl: printableUrl});

      if (isAbortedError(e)) {
        if (abortSignals.some((s) => s?.aborted)) {
          throw new ErrorAborted(`${routeId} request`);
        }
        if (controller.signal.aborted) {
          throw new TimeoutError(`${routeId} request`);
        }
        throw Error("Unknown aborted error");
      }
      throw e;
    } finally {
      timer?.();

      clearTimeout(timeout);
      for (const s of abortSignals) {
        s?.removeEventListener("abort", onSignalAbort);
      }
    }
  }

  private getRequestMethod(init: ApiRequestInitRequired): typeof this._request {
    return init.requestWireFormat === WireFormat.ssz ? this.requestFallbackToJson.bind(this) : this._request.bind(this);
  }
}

function mergeInits<E extends Endpoint>(
  definition: RouteDefinitionExtra<E>,
  urlInit: UrlInitRequired,
  localInit: ApiRequestInit
): ApiRequestInitRequired {
  return {
    ...defaultInit,
    ...definition.init,
    // Sanitize user provided values
    ...removeUndefined(urlInit),
    ...removeUndefined(localInit),
    headers: mergeHeaders(urlInit.headers, localInit.headers),
  };
}

function removeUndefined<T extends object>(obj: T): {[K in keyof T]: Exclude<T[K], undefined>} {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

function isAbortedError(e: unknown): boolean {
  return isFetchError(e) && e.type === "aborted";
}
