import {fetch} from "cross-fetch";
import {AbortSignal, AbortController} from "@chainsafe/abort-controller";
import {ErrorAborted, ILogger, TimeoutError} from "@chainsafe/lodestar-utils";
import {ReqGeneric, RouteDef} from "../../utils";
import {stringifyQuery, urlJoin} from "./format";
import {Metrics} from "./metrics";

export class HttpError extends Error {
  status: number;
  url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

export type FetchOpts = {
  url: RouteDef["url"];
  method: RouteDef["method"];
  query?: ReqGeneric["query"];
  body?: ReqGeneric["body"];
  headers?: ReqGeneric["headers"];
  /** Optional, for metrics */
  routeId?: string;
};

export interface IHttpClient {
  baseUrl: string;
  json<T>(opts: FetchOpts): Promise<T>;
  arrayBuffer(opts: FetchOpts): Promise<ArrayBuffer>;
}

export type HttpClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  /** Return an AbortSignal to be attached to all requests */
  getAbortSignal?: () => AbortSignal | undefined;
  /** Override fetch function */
  fetch?: typeof fetch;
};

export type HttpClientModules = {
  logger?: ILogger;
  metrics?: Metrics;
};

export class HttpClient implements IHttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly getAbortSignal?: () => AbortSignal | undefined;
  private readonly fetch: typeof fetch;
  private readonly metrics: null | Metrics;
  private readonly logger: null | ILogger;

  /**
   * timeoutMs = config.params.SECONDS_PER_SLOT * 1000
   */
  constructor(opts: HttpClientOptions, {logger, metrics}: HttpClientModules = {}) {
    this.baseUrl = opts.baseUrl;
    // A higher default timeout, validator will sets its own shorter timeoutMs
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.getAbortSignal = opts.getAbortSignal;
    this.fetch = opts.fetch ?? fetch;
    this.metrics = metrics ?? null;
    this.logger = logger ?? null;
  }

  async json<T>(opts: FetchOpts): Promise<T> {
    return await this.request<T>(opts, (res) => res.json() as Promise<T>);
  }

  async arrayBuffer(opts: FetchOpts): Promise<ArrayBuffer> {
    return await this.request<ArrayBuffer>(opts, (res) => res.arrayBuffer());
  }

  private async request<T>(opts: FetchOpts, getBody: (res: Response) => Promise<T>): Promise<T> {
    // Implement fetch timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    // Attach global signal to this request's controller
    const signalGlobal = this.getAbortSignal && this.getAbortSignal();
    if (signalGlobal) {
      signalGlobal.addEventListener("abort", () => controller.abort());
    }

    const routeId = opts.routeId; // TODO: Should default to "unknown"?
    const timer = this.metrics?.requestTime.startTimer({routeId});

    try {
      const url = urlJoin(this.baseUrl, opts.url) + (opts.query ? "?" + stringifyQuery(opts.query) : "");

      const headers = opts.headers || {};
      if (opts.body) headers["Content-Type"] = "application/json";

      this.logger?.debug("HttpClient request", {routeId});

      const res = await this.fetch(url, {
        method: opts.method,
        headers: headers as Record<string, string>,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new HttpError(`${res.statusText}: ${getErrorMessage(errBody)}`, res.status, url);
      }

      this.logger?.debug("HttpClient response", {routeId});

      return await getBody(res);
    } catch (e) {
      if (isAbortedError(e as Error)) {
        if (signalGlobal?.aborted) {
          throw new ErrorAborted("REST client");
        } else if (controller.signal.aborted) {
          throw new TimeoutError("request");
        } else {
          throw Error("Unknown aborted error");
        }
      }

      this.metrics?.errors.inc({routeId});

      throw e;
    } finally {
      timer?.();

      clearTimeout(timeout);
      if (signalGlobal) {
        signalGlobal.removeEventListener("abort", controller.abort);
      }
    }
  }
}

function isAbortedError(e: Error): boolean {
  return e.name === "AbortError" || e.message === "The user aborted a request";
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
