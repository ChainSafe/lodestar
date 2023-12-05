import {ErrorAborted, Logger, TimeoutError, isValidHttpUrl} from "@lodestar/utils";
import {WireFormat, mergeHeaders} from "../headers.js";
import {Endpoint} from "../types.js";
import {ApiRequestInit, ApiRequestInitRequired, RouteDefinitionExtra, createApiRequest} from "./request.js";
import {ApiResponse} from "./response.js";
import {Metrics} from "./metrics.js";
import {isFetchError} from "./fetch.js";

/** A higher default timeout, validator will sets its own shorter timeoutMs */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_WIRE_FORMAT = WireFormat.json;
const DEFAULT_RESPONSE_WIRE_FORMAT = WireFormat.ssz;

const URL_SCORE_DELTA_SUCCESS = 1;
/** Require 2 success to recover from 1 failed request */
const URL_SCORE_DELTA_ERROR = 2 * URL_SCORE_DELTA_SUCCESS;
/** In case of continued errors, require 10 success to mark the URL as healthy */
const URL_SCORE_MAX = 10 * URL_SCORE_DELTA_SUCCESS;
const URL_SCORE_MIN = 0;

export interface IHttpClient {
  readonly baseUrl: string;

  request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit
  ): Promise<ApiResponse<E>>;
}

export type HttpClientOptions = ({baseUrl: string} | {urls: (string | ApiRequestInit)[]}) & {
  globalInit?: ApiRequestInit;
  /** Override fetch function */
  fetch?: typeof fetch;
};

export type HttpClientModules = {
  logger?: Logger;
  metrics?: Metrics;
};

export class HttpClient implements IHttpClient {
  readonly urlsInits: ApiRequestInitRequired[] = [];

  private readonly fetch: typeof fetch;
  private readonly metrics: null | Metrics;
  private readonly logger: null | Logger;

  private readonly urlsScore: number[];

  get baseUrl(): string {
    return this.urlsInits[0].baseUrl;
  }

  constructor(opts: HttpClientOptions, {logger, metrics}: HttpClientModules = {}) {
    // Cast to all types optional since they are defined with syntax `HttpClientOptions = A | B`
    const {baseUrl, urls = []} = opts as {baseUrl?: string; urls?: (string | ApiRequestInit)[]};
    const globalInit = opts.globalInit;
    const defaults = {
      baseUrl: "",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      requestWireFormat: DEFAULT_REQUEST_WIRE_FORMAT,
      responseWireFormat: DEFAULT_RESPONSE_WIRE_FORMAT,
    };

    // opts.baseUrl is equivalent to `urls: [{baseUrl}]`
    // unshift opts.baseUrl to urls, without mutating opts.urls
    for (const [i, urlOrInit] of [...(baseUrl ? [baseUrl] : []), ...urls].entries()) {
      const init = typeof urlOrInit === "string" ? {baseUrl: urlOrInit} : urlOrInit;
      const urlInit: ApiRequestInitRequired = {
        ...defaults,
        ...globalInit,
        ...init,
        headers: mergeHeaders(globalInit?.headers, init.headers),
      };

      if (!urlInit.baseUrl) {
        throw Error(`HttpClient.urls[${i}] is empty or undefined: ${urlInit.baseUrl}`);
      }
      if (!isValidHttpUrl(urlInit.baseUrl)) {
        throw Error(`HttpClient.urls[${i}] must be a valid URL: ${urlInit.baseUrl}`);
      }
      // De-duplicate by baseUrl, having two baseUrls with different token or timeouts does not make sense
      if (!this.urlsInits.some((opt) => opt.baseUrl === urlInit.baseUrl)) {
        this.urlsInits.push(urlInit);
      }
    }

    if (this.urlsInits.length === 0) {
      throw Error("Must set at least 1 URL in HttpClient opts");
    }

    // Initialize scores to max value to only query first URL on start
    this.urlsScore = this.urlsInits.map(() => URL_SCORE_MAX);

    this.fetch = opts.fetch ?? fetch;
    this.metrics = metrics ?? null;
    this.logger = logger ?? null;

    if (metrics) {
      metrics.urlsScore.addCollect(() => {
        for (let i = 0; i < this.urlsScore.length; i++) {
          metrics.urlsScore.set({urlIndex: i}, this.urlsScore[i]);
        }
      });
    }
  }

  /**
   * Request with possible retries
   */
  async request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit
  ): Promise<ApiResponse<E>> {
    // Early return when no fallback URLs are setup
    if (this.urlsInits.length === 1) {
      return this._request(definition, args, localInit, 0);
    }

    let i = 0;

    // Goals:
    // - if first server is stable and responding do not query fallbacks
    // - if first server errors, retry that same request on fallbacks
    // - until first server is shown to be reliable again, contact all servers

    // First loop: retry in sequence, query next URL only after previous errors
    for (; i < this.urlsInits.length; i++) {
      try {
        return await new Promise<ApiResponse<E>>((resolve, reject) => {
          let requestCount = 0;
          let errorCount = 0;

          // Second loop: query all URLs up to the next healthy at once, racing them.
          // Score each URL available:
          // - If url[0] is good, only send to 0
          // - If url[0] has recently errored, send to both 0, 1, etc until url[0] does not error for some time
          for (; i < this.urlsInits.length; i++) {
            const baseUrl = this.urlsInits[i].baseUrl;
            const routeId = definition.operationId;

            if (i > 0) {
              this.metrics?.requestToFallbacks.inc({routeId});
              this.logger?.debug("Requesting fallback URL", {routeId, baseUrl, score: this.urlsScore[i]});
            }

            // eslint-disable-next-line @typescript-eslint/naming-convention
            const i_ = i; // Keep local copy of i variable to index urlScore after requestWithBody() resolves

            this._request(definition, args, localInit, i).then(
              (res) => {
                this.urlsScore[i_] = Math.min(URL_SCORE_MAX, this.urlsScore[i_] + URL_SCORE_DELTA_SUCCESS);
                // Resolve immediately on success
                resolve(res);
              },
              (err) => {
                this.urlsScore[i_] = Math.max(URL_SCORE_MIN, this.urlsScore[i_] - URL_SCORE_DELTA_ERROR);

                // Reject only when all queried URLs have errored
                // TODO: Currently rejects with last error only, should join errors?
                if (++errorCount >= requestCount) {
                  reject(err);
                } else {
                  this.logger?.debug("Request error, retrying", {routeId, baseUrl}, err);
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
      } catch (e) {
        if (i >= this.urlsInits.length - 1) {
          throw e;
        } else {
          this.logger?.debug("Request error, retrying", {}, e as Error);
        }
      }
    }

    throw Error("loop ended without return or rejection");
  }

  async _request<E extends Endpoint>(
    definition: RouteDefinitionExtra<E>,
    args: E["args"],
    localInit: ApiRequestInit,
    urlIndex = 0
  ): Promise<ApiResponse<E>> {
    const globalInit = this.urlsInits[urlIndex];
    if (globalInit === undefined) {
      throw new Error(`Url at index ${urlIndex} does not exist`);
    }
    const init = {
      ...globalInit,
      ...localInit,
      headers: mergeHeaders(globalInit.headers, localInit.headers),
    };

    // Implement fetch timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
    init.signal = controller.signal;

    // Attach global/local signal to this request's controller
    const onGlobalSignalAbort = (): void => controller.abort();
    const signalGlobal = globalInit.signal;
    const signalLocal = localInit.signal;
    signalGlobal?.addEventListener("abort", onGlobalSignalAbort);
    signalLocal?.addEventListener("abort", onGlobalSignalAbort);

    const routeId = definition.operationId;
    const timer = this.metrics?.requestTime.startTimer({routeId});

    try {
      this.logger?.debug("API request begin", {routeId});
      const request = createApiRequest(definition, args, init);
      const response = await this.fetch(request.url, request);
      const apiResponse = new ApiResponse(definition, response.body, response);

      if (!apiResponse.ok) {
        this.logger?.debug("API response error", {routeId});
        this.metrics?.requestErrors.inc({routeId});
        return apiResponse;
      }

      const streamTimer = this.metrics?.streamTime.startTimer();
      try {
        await apiResponse.rawBody();
        this.logger?.debug("API response success", {routeId});
        return apiResponse;
      } finally {
        streamTimer?.();
      }
    } catch (e) {
      this.metrics?.requestErrors.inc({routeId});

      if (isAbortedError(e)) {
        if (signalGlobal?.aborted || signalLocal?.aborted) {
          throw new ErrorAborted(`${definition.operationId} request`);
        } else if (controller.signal.aborted) {
          throw new TimeoutError(`${definition.operationId} request`);
        } else {
          throw Error("Unknown aborted error");
        }
      } else {
        throw e;
      }
    } finally {
      timer?.();

      clearTimeout(timeout);
      signalGlobal?.removeEventListener("abort", onGlobalSignalAbort);
      signalLocal?.removeEventListener("abort", onGlobalSignalAbort);
    }
  }
}

function isAbortedError(e: unknown): boolean {
  return isFetchError(e) && e.type === "aborted";
}
