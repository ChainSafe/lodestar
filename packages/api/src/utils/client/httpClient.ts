import {ErrorAborted, Logger, TimeoutError, isValidHttpUrl, toBase64} from "@lodestar/utils";
import {ReqGeneric, RouteDef} from "../index.js";
import {ApiClientResponse, ApiClientSuccessResponse} from "../../interfaces.js";
import {fetch, isFetchError} from "./fetch.js";
import {stringifyQuery, urlJoin} from "./format.js";
import {Metrics} from "./metrics.js";
import {HttpStatusCode} from "./httpStatusCode.js";

/** A higher default timeout, validator will sets its own shorter timeoutMs */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ROUTE_ID = "unknown";

const URL_SCORE_DELTA_SUCCESS = 1;
/** Require 2 success to recover from 1 failed request */
const URL_SCORE_DELTA_ERROR = 2 * URL_SCORE_DELTA_SUCCESS;
/** In case of continued errors, require 10 success to mark the URL as healthy */
const URL_SCORE_MAX = 10 * URL_SCORE_DELTA_SUCCESS;
const URL_SCORE_MIN = 0;

export class HttpError extends Error {
  status: number;
  url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

export class ApiError extends Error {
  status: number;
  operationId: string;

  constructor(message: string, status: number, operationId: string) {
    super(message);
    this.status = status;
    this.operationId = operationId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static assert(res: ApiClientResponse, message?: string): asserts res is ApiClientSuccessResponse<any, unknown> {
    if (!res.ok) {
      throw new ApiError([message, res.error.message].join(" - "), res.error.code, res.error.operationId);
    }
  }

  toString(): string {
    return `${this.message} (status=${this.status}, operationId=${this.operationId})`;
  }
}

export interface URLOpts {
  baseUrl: string;
  timeoutMs?: number;
  bearerToken?: string;
  extraHeaders?: Record<string, string>;
}

export type FetchOpts = {
  url: RouteDef["url"];
  method: RouteDef["method"];
  query?: ReqGeneric["query"];
  body?: ReqGeneric["body"];
  headers?: ReqGeneric["headers"];
  /** Optional, for metrics */
  routeId?: string;
  timeoutMs?: number;
};

export interface IHttpClient {
  baseUrl: string;
  json<T>(opts: FetchOpts): Promise<{status: HttpStatusCode; body: T}>;
  request(opts: FetchOpts): Promise<{status: HttpStatusCode; body: void}>;
  arrayBuffer(opts: FetchOpts): Promise<{status: HttpStatusCode; body: ArrayBuffer}>;
}

export type HttpClientOptions = ({baseUrl: string} | {urls: (string | URLOpts)[]}) & {
  timeoutMs?: number;
  bearerToken?: string;
  extraHeaders?: Record<string, string>;
  /** Return an AbortSignal to be attached to all requests */
  getAbortSignal?: () => AbortSignal | undefined;
  /** Override fetch function */
  fetch?: typeof fetch;
};

export type HttpClientModules = {
  logger?: Logger;
  metrics?: Metrics;
};

export {Metrics};

export class HttpClient implements IHttpClient {
  private readonly globalTimeoutMs: number;
  private readonly globalBearerToken: string | null;
  private readonly globalExtraHeaders: Record<string, string> | null;
  private readonly getAbortSignal?: () => AbortSignal | undefined;
  private readonly fetch: typeof fetch;
  private readonly metrics: null | Metrics;
  private readonly logger: null | Logger;

  private readonly urlsOpts: URLOpts[] = [];
  private readonly urlsScore: number[];

  get baseUrl(): string {
    return this.urlsOpts[0].baseUrl;
  }

  /**
   * timeoutMs = config.params.SECONDS_PER_SLOT * 1000
   */
  constructor(opts: HttpClientOptions, {logger, metrics}: HttpClientModules = {}) {
    // Cast to all types optional since they are defined with syntax `HttpClientOptions = A | B`
    const {baseUrl, urls = []} = opts as {baseUrl?: string; urls?: (string | URLOpts)[]};

    // Append to Partial object to not fill urlOpts with properties with value undefined
    const allUrlOpts: Partial<URLOpts> = {};
    if (opts.bearerToken) allUrlOpts.bearerToken = opts.bearerToken;
    if (opts.timeoutMs !== undefined) allUrlOpts.timeoutMs = opts.timeoutMs;
    if (opts.extraHeaders) allUrlOpts.extraHeaders = opts.extraHeaders;

    // opts.baseUrl is equivalent to `urls: [{baseUrl}]`
    // unshift opts.baseUrl to urls, without mutating opts.urls
    for (const [i, urlOrOpts] of [...(baseUrl ? [baseUrl] : []), ...urls].entries()) {
      const urlOpts: URLOpts = typeof urlOrOpts === "string" ? {baseUrl: urlOrOpts, ...allUrlOpts} : urlOrOpts;

      if (!urlOpts.baseUrl) {
        throw Error(`HttpClient.urls[${i}] is empty or undefined: ${urlOpts.baseUrl}`);
      }
      if (!isValidHttpUrl(urlOpts.baseUrl)) {
        throw Error(`HttpClient.urls[${i}] must be a valid URL: ${urlOpts.baseUrl}`);
      }
      // De-duplicate by baseUrl, having two baseUrls with different token or timeouts does not make sense
      if (!this.urlsOpts.some((opt) => opt.baseUrl === urlOpts.baseUrl)) {
        this.urlsOpts.push(urlOpts);
      }
    }

    if (this.urlsOpts.length === 0) {
      throw Error("Must set at least 1 URL in HttpClient opts");
    }

    // Initialize scores to max value to only query first URL on start
    this.urlsScore = this.urlsOpts.map(() => URL_SCORE_MAX);

    this.globalTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.globalBearerToken = opts.bearerToken ?? null;
    this.globalExtraHeaders = opts.extraHeaders ?? null;
    this.getAbortSignal = opts.getAbortSignal;
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

  async json<T>(opts: FetchOpts): Promise<{status: HttpStatusCode; body: T}> {
    return this.requestWithBodyWithRetries<T>(opts, (res) => res.json() as Promise<T>);
  }

  async request(opts: FetchOpts): Promise<{status: HttpStatusCode; body: void}> {
    return this.requestWithBodyWithRetries<void>(opts, async () => undefined);
  }

  async arrayBuffer(opts: FetchOpts): Promise<{status: HttpStatusCode; body: ArrayBuffer}> {
    return this.requestWithBodyWithRetries<ArrayBuffer>(opts, (res) => res.arrayBuffer());
  }

  private async requestWithBodyWithRetries<T>(
    opts: FetchOpts,
    getBody: (res: Response) => Promise<T>
  ): Promise<{status: HttpStatusCode; body: T}> {
    // Early return when no fallback URLs are setup
    if (this.urlsOpts.length === 1) {
      return this.requestWithBody(this.urlsOpts[0], opts, getBody);
    }

    let i = 0;

    // Goals:
    // - if first server is stable and responding do not query fallbacks
    // - if first server errors, retry that same request on fallbacks
    // - until first server is shown to be reliable again, contact all servers

    // First loop: retry in sequence, query next URL only after previous errors
    for (; i < this.urlsOpts.length; i++) {
      try {
        return await new Promise<{status: HttpStatusCode; body: T}>((resolve, reject) => {
          let requestCount = 0;
          let errorCount = 0;

          // Second loop: query all URLs up to the next healthy at once, racing them.
          // Score each URL available:
          // - If url[0] is good, only send to 0
          // - If url[0] has recently errored, send to both 0, 1, etc until url[0] does not error for some time
          for (; i < this.urlsOpts.length; i++) {
            const urlOpts = this.urlsOpts[i];
            const {baseUrl} = urlOpts;
            const routeId = opts.routeId ?? DEFAULT_ROUTE_ID;

            if (i > 0) {
              this.metrics?.requestToFallbacks.inc({routeId});
              this.logger?.debug("Requesting fallback URL", {routeId, baseUrl, score: this.urlsScore[i]});
            }

            // eslint-disable-next-line @typescript-eslint/naming-convention
            const i_ = i; // Keep local copy of i variable to index urlScore after requestWithBody() resolves

            this.requestWithBody(urlOpts, opts, getBody).then(
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
        if (i >= this.urlsOpts.length - 1) {
          throw e;
        } else {
          this.logger?.debug("Request error, retrying", {}, e as Error);
        }
      }
    }

    throw Error("loop ended without return or rejection");
  }

  private async requestWithBody<T>(
    urlOpts: URLOpts,
    opts: FetchOpts,
    getBody: (res: Response) => Promise<T>
  ): Promise<{status: HttpStatusCode; body: T}> {
    const baseUrl = urlOpts.baseUrl;
    const bearerToken = urlOpts.bearerToken ?? this.globalBearerToken;
    const extraHeaders = urlOpts.extraHeaders ?? this.globalExtraHeaders;
    const timeoutMs = opts.timeoutMs ?? urlOpts.timeoutMs ?? this.globalTimeoutMs;

    // Implement fetch timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs ?? this.globalTimeoutMs);

    // Attach global signal to this request's controller
    const onGlobalSignalAbort = (): void => controller.abort();
    const signalGlobal = this.getAbortSignal?.();
    signalGlobal?.addEventListener("abort", onGlobalSignalAbort);

    const routeId = opts.routeId ?? DEFAULT_ROUTE_ID;
    const timer = this.metrics?.requestTime.startTimer({routeId});

    try {
      const url = new URL(urlJoin(baseUrl, opts.url) + (opts.query ? "?" + stringifyQuery(opts.query) : ""));

      const headers =
        extraHeaders && opts.headers ? {...extraHeaders, ...opts.headers} : opts.headers || extraHeaders || {};
      if (opts.body && headers["Content-Type"] === undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (bearerToken && headers["Authorization"] === undefined) {
        headers["Authorization"] = `Bearer ${bearerToken}`;
      }
      if (url.username || url.password) {
        if (headers["Authorization"] === undefined) {
          headers["Authorization"] = `Basic ${toBase64(`${url.username}:${url.password}`)}`;
        }
        // Remove the username and password from the URL
        url.username = "";
        url.password = "";
      }

      this.logger?.debug("HttpClient request", {routeId});

      const res = await this.fetch(url, {
        method: opts.method,
        headers: headers as Record<string, string>,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new HttpError(`${res.statusText}: ${getErrorMessage(errBody)}`, res.status, url.toString());
      }

      const streamTimer = this.metrics?.streamTime.startTimer({routeId});
      const body = await getBody(res);
      streamTimer?.();
      this.logger?.debug("HttpClient response", {routeId});
      return {status: res.status, body};
    } catch (e) {
      this.metrics?.requestErrors.inc({routeId});

      if (isAbortedError(e as Error)) {
        if (signalGlobal?.aborted) {
          throw new ErrorAborted("REST client");
        } else if (controller.signal.aborted) {
          throw new TimeoutError("request");
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
    }
  }
}

function isAbortedError(e: Error): boolean {
  return isFetchError(e) && e.type === "aborted";
}

function getErrorMessage(errBody: string): string {
  try {
    const errJson = JSON.parse(errBody) as {message: string};
    if (errJson.message) {
      return errJson.message;
    } else {
      return errBody;
    }
  } catch (e) {
    return errBody;
  }
}
