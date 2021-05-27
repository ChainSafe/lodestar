import {fetch} from "cross-fetch";
import {AbortSignal, AbortController} from "abort-controller";
import {ErrorAborted, TimeoutError} from "@chainsafe/lodestar-utils";
import {ReqGeneric, RouteDef} from "../../utils";
import {stringifyQuery, urlJoin} from "./format";

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

export class HttpClient implements IHttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly getAbortSignal?: () => AbortSignal | undefined;
  private readonly fetch: typeof fetch;

  /**
   * timeoutMs = config.params.SECONDS_PER_SLOT * 1000
   */
  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs ?? 12000;
    this.getAbortSignal = opts.getAbortSignal;
    this.fetch = opts.fetch ?? fetch;
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

    try {
      const url = urlJoin(this.baseUrl, opts.url) + (opts.query ? "?" + stringifyQuery(opts.query) : "");
      const bodyArgs = opts.body
        ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(opts.body)}
        : {};

      const res = await this.fetch(url, {method: opts.method, ...bodyArgs, signal: controller.signal});

      if (!res.ok) {
        const errBody = await res.text();
        throw new HttpError(`${res.statusText}: ${getErrorMessage(errBody)}`, res.status, url);
      }

      return await getBody(res);
    } catch (e) {
      if (isAbortedError(e)) {
        if (signalGlobal?.aborted) {
          throw new ErrorAborted("REST client");
        } else if (controller.signal.aborted) {
          throw new TimeoutError("request");
        } else {
          throw Error("Unknown aborted error");
        }
      }
      throw e;
    } finally {
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
