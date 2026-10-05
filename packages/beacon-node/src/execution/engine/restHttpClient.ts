import {ErrorAborted, FetchError, LodestarError, TimeoutError, fetch, isValidHttpUrl, retry} from "@lodestar/utils";
import {
  JsonRpcHttpClientEvent,
  JsonRpcHttpClientEventEmitter,
  JsonRpcHttpClientMetrics,
  ReqOpts,
} from "./jsonRpcHttpClient.js";
import {JwtClaim, encodeJwtToken} from "./jwt.js";
import {ExecutionForkName} from "./sszTypes.js";

export const ENGINE_REST_BASE_PATH = "/engine/v1";
export const EXECUTION_VERSION_HEADER = "Eth-Execution-Version";
export const CLIENT_VERSION_HEADER = "X-Engine-Client-Version";
export const MEDIA_TYPE_SSZ = "application/octet-stream";
export const MEDIA_TYPE_JSON = "application/json";

const REQUEST_TIMEOUT = 30 * 1000;
/** Limits the amount of error detail printed with REST errors */
const MAX_ERROR_DETAIL_LENGTH = 500;

export type EngineRestRequest = {
  method: "GET" | "POST";
  /** Path relative to the `/engine/v1` base path */
  path: string;
  query?: Record<string, string | number>;
  /** Sets the `Eth-Execution-Version` header on fork-scoped endpoints */
  executionFork?: ExecutionForkName;
  /** SSZ encoded request body */
  body?: Uint8Array;
  responseType: "ssz" | "json";
};

export type EngineRestResponse = {
  status: number;
  /** Empty on `204 No Content` */
  body: Uint8Array;
};

/** Non-2xx response, `type` and `detail` are taken from the problem+json body when present */
export class EngineRestError extends Error {
  constructor(
    readonly status: number,
    readonly type: string | null,
    readonly detail: string | null,
    routeId: string
  ) {
    super(
      `Engine REST error: status=${status} type=${type ?? "unknown"}${detail ? ` detail=${detail}` : ""}, ${routeId}`
    );
  }
}

export class EngineRestResponseError extends LodestarError<{
  code: "ENGINE_REST_INVALID_RESPONSE";
  routeId: string;
  reason: string;
}> {
  constructor(routeId: string, reason: string) {
    super(
      {code: "ENGINE_REST_INVALID_RESPONSE", routeId, reason},
      `Invalid engine REST response: ${reason}, ${routeId}`
    );
  }
}

/** Successful response in a different media type, e.g. a legacy JSON-RPC server that answers any GET */
export class EngineRestContentTypeError extends EngineRestResponseError {
  constructor(
    routeId: string,
    readonly contentType: string | undefined
  ) {
    super(routeId, `Unexpected content type ${contentType}`);
  }
}

export type EngineRestHttpClientOpts = {
  signal?: AbortSignal;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  /** HS256 secret, a fresh token is generated for every request as ELs check `iat` freshness */
  jwtSecret?: Uint8Array;
  /** Included as `id` claim if `jwtSecret` is provided */
  jwtId?: string;
  /** Value of the `X-Engine-Client-Version` header, the `clv` JWT claim is removed in the REST API */
  clientVersion?: string;
  metrics?: JsonRpcHttpClientMetrics | null;
};

/**
 * HTTP/1.1 client for the REST engine API. Only transport concerns live here, encoding of
 * request and response bodies is up to the caller.
 */
export class EngineRestHttpClient {
  readonly emitter = new JsonRpcHttpClientEventEmitter();
  private readonly metrics: JsonRpcHttpClientMetrics | null;

  constructor(
    private readonly urls: string[],
    private readonly opts: EngineRestHttpClientOpts = {}
  ) {
    if (urls.length === 0) {
      throw Error("No urls provided to EngineRestHttpClient");
    }
    for (const [i, url] of urls.entries()) {
      if (!isValidHttpUrl(url)) {
        throw Error(`EngineRestHttpClient.urls[${i}] must be a valid URL: ${url}`);
      }
    }
    this.metrics = opts.metrics ?? null;
  }

  /** Perform request with retries, emitting response and error events consumed by the engine state tracking */
  async request(req: EngineRestRequest, opts?: ReqOpts): Promise<EngineRestResponse> {
    try {
      const response = await this.requestWithRetries(req, opts);
      this.emitter.emit(JsonRpcHttpClientEvent.RESPONSE, {payload: req, response});
      return response;
    } catch (error) {
      this.emitter.emit(JsonRpcHttpClientEvent.ERROR, {payload: req, error: error as Error});
      throw error;
    }
  }

  /** Perform request with retries without emitting events, used to probe support for the REST API */
  async requestWithRetries(req: EngineRestRequest, opts?: ReqOpts): Promise<EngineRestResponse> {
    const routeId = opts?.routeId ?? "unknown";
    return retry(() => this.requestAnyUrl(req, opts), {
      retries: opts?.retries ?? this.opts.retries ?? 0,
      retryDelay: opts?.retryDelay ?? this.opts.retryDelay,
      shouldRetry: opts?.shouldRetry ?? isRetryableEngineRestError,
      signal: this.opts.signal,
      onRetry: () => {
        this.metrics?.retryCount.inc({routeId});
      },
    });
  }

  private async requestAnyUrl(req: EngineRestRequest, opts?: ReqOpts): Promise<EngineRestResponse> {
    const routeId = opts?.routeId ?? "unknown";
    let lastError: Error | null = null;

    for (let i = 0; i < this.urls.length; i++) {
      if (i > 0) {
        this.metrics?.requestUsedFallbackUrl.inc({routeId});
      }

      try {
        return await this.requestOneUrl(this.urls[i], req, opts);
      } catch (e) {
        if (!isRetryableEngineRestError(e as Error)) {
          throw e;
        }
        lastError = e as Error;
      }
    }
    throw lastError ?? Error("Unknown error");
  }

  private async requestOneUrl(baseUrl: string, req: EngineRestRequest, opts?: ReqOpts): Promise<EngineRestResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeout ?? this.opts.timeout ?? REQUEST_TIMEOUT);

    const signal = this.opts.signal ? AbortSignal.any([controller.signal, this.opts.signal]) : controller.signal;

    const routeId = opts?.routeId ?? "unknown";
    const timer = this.metrics?.requestTime.startTimer({routeId});
    this.metrics?.activeRequests.inc({routeId}, 1);

    try {
      const url = new URL(`${ENGINE_REST_BASE_PATH}${req.path}`, baseUrl);
      for (const [key, value] of Object.entries(req.query ?? {})) {
        url.searchParams.set(key, String(value));
      }

      const headers: Record<string, string> = {
        Accept: req.responseType === "ssz" ? MEDIA_TYPE_SSZ : MEDIA_TYPE_JSON,
      };
      if (req.body !== undefined) {
        headers["Content-Type"] = MEDIA_TYPE_SSZ;
      }
      if (req.executionFork !== undefined) {
        headers[EXECUTION_VERSION_HEADER] = req.executionFork;
      }
      if (this.opts.clientVersion !== undefined) {
        headers[CLIENT_VERSION_HEADER] = this.opts.clientVersion;
      }
      if (this.opts.jwtSecret) {
        const jwtClaim: JwtClaim = {iat: Math.floor(Date.now() / 1000), id: this.opts.jwtId};
        headers.Authorization = `Bearer ${encodeJwtToken(jwtClaim, this.opts.jwtSecret)}`;
      }

      this.metrics?.requestBytes.inc({routeId}, req.body?.length ?? 0);

      const res = await fetch(url, {
        method: req.method,
        body: req.body as BodyInit | undefined,
        headers,
        signal,
      });

      const streamTimer = this.metrics?.streamTime.startTimer({routeId});
      let body: Uint8Array;
      try {
        body = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        throw new FetchError(url, e);
      } finally {
        streamTimer?.();
      }
      this.metrics?.responseBytes.inc({routeId}, body.length);

      if (!res.ok) {
        const {type, detail} = parseProblemBody(body);
        throw new EngineRestError(res.status, type, detail, routeId);
      }

      if (res.status !== 200 && res.status !== 204) {
        throw new EngineRestResponseError(routeId, `Unexpected status ${res.status}`);
      }
      const contentType = res.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      const expectedContentType = req.responseType === "ssz" ? MEDIA_TYPE_SSZ : MEDIA_TYPE_JSON;
      if (res.status !== 204 && contentType !== expectedContentType) {
        throw new EngineRestContentTypeError(routeId, contentType);
      }

      return {status: res.status, body};
    } catch (e) {
      this.metrics?.requestErrors.inc({routeId});
      if (signal.aborted) {
        if (this.opts.signal?.aborted) {
          throw new ErrorAborted("request");
        }
        throw new TimeoutError("request");
      }
      throw e;
    } finally {
      timer?.();
      this.metrics?.activeRequests.dec({routeId}, 1);

      clearTimeout(timeout);
    }
  }
}

/** Client errors are deterministic, only transport failures and server errors are worth retrying */
export function isRetryableEngineRestError(e: Error): boolean {
  return (
    (e instanceof EngineRestError && e.status >= 500) ||
    e instanceof TimeoutError ||
    (e instanceof FetchError && e.type !== "input" && e.type !== "aborted")
  );
}

function parseProblemBody(body: Uint8Array): {type: string | null; detail: string | null} {
  const text = new TextDecoder().decode(body);
  try {
    const problem: unknown = JSON.parse(text);
    if (typeof problem === "object" && problem !== null) {
      return {
        type: "type" in problem && typeof problem.type === "string" ? problem.type : null,
        detail:
          ("detail" in problem && typeof problem.detail === "string" ? problem.detail : text).slice(
            0,
            MAX_ERROR_DETAIL_LENGTH
          ) || null,
      };
    }
  } catch {
    // Legacy endpoints and proxies may return plain text instead of a problem document.
  }
  return {type: null, detail: text.slice(0, MAX_ERROR_DETAIL_LENGTH) || null};
}
