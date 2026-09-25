import {FetchError, fetch, fromHex, retry} from "@lodestar/utils";
import {HttpRpcError} from "./jsonRpcHttpClient.js";
import {JwtClaim, encodeJwtToken} from "./jwt.js";
import {ElForkName} from "./sszRestEncoding.js";

export interface SszRestClientOpts {
  /** Engine URL without trailing slash; paths are appended verbatim. */
  baseUrl: string;
  /** Value of `X-Engine-Client-Version`, e.g. `LS/v1.40.0`. */
  clientVersionHeader: string;
  jwtSecretHex?: string;
  jwtId?: string;
  /** Request timeout in milliseconds. Defaults to 12000. */
  timeout?: number;
  /** Node shutdown signal; aborts in-flight requests instead of leaving them to time out. */
  signal?: AbortSignal;
  /** Retries for transport-level failures, mirroring `--execution.retries`. Defaults to 0. */
  retries?: number;
  /** Delay between retries in milliseconds, mirroring `--execution.retryDelay`. */
  retryDelay?: number;
}

export type SszRequestOpts = {
  /** Set only on fork-scoped endpoints; becomes `Eth-Execution-Version`. */
  fork?: ElForkName;
  body?: Uint8Array;
  /** Overrides the client default for this call; 0 disables retries. */
  retries?: number;
};

const DEFAULT_TIMEOUT = 12_000;
const OCTET_STREAM = "application/octet-stream";
const JSON_TYPE = "application/json";

/**
 * Non-2xx response from the SSZ-REST Engine API.
 *
 * Extends HttpRpcError so the engine's existing `instanceof HttpRpcError` checks
 * classify REST failures exactly like JSON-RPC HTTP failures (ELERROR / SYNCING).
 * `type` is the RFC 7807 problem URI (`/engine-api/errors/...`) when the EL sent one.
 */
export class SszRestError extends HttpRpcError {
  constructor(
    status: number,
    readonly type: string | undefined,
    readonly detail: string | undefined,
    statusText: string
  ) {
    super(status, `SSZ-REST ${status} ${type ?? statusText}${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * SSZ-REST Engine API HTTP client (ethereum/execution-apis#793).
 *
 * Transport only: headers, JWT, status handling. Uses the runtime's global fetch
 * dispatcher (keep-alive pooled) like the JSON-RPC client; no custom agent.
 */
export class SszRestClient {
  private readonly baseUrl: string;
  private readonly clientVersionHeader: string;
  private readonly jwtSecret: Uint8Array | undefined;
  private readonly jwtId: string | undefined;
  private readonly timeout: number;
  private readonly signal: AbortSignal | undefined;
  private readonly retries: number;
  private readonly retryDelay: number | undefined;

  constructor(opts: SszRestClientOpts) {
    this.baseUrl = opts.baseUrl;
    this.clientVersionHeader = opts.clientVersionHeader;
    this.jwtSecret = opts.jwtSecretHex ? fromHex(opts.jwtSecretHex) : undefined;
    this.jwtId = opts.jwtId;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    this.signal = opts.signal;
    this.retries = opts.retries ?? 0;
    this.retryDelay = opts.retryDelay;
  }

  /** SSZ endpoint: 200 -> body bytes, 204 -> null, otherwise throws SszRestError. */
  async requestSsz(method: "GET" | "POST", path: string, opts: SszRequestOpts = {}): Promise<Uint8Array | null> {
    return this.send(method, path, OCTET_STREAM, opts, async (res) => {
      if (res.status === 204) return null;
      return new Uint8Array(await res.arrayBuffer());
    });
  }

  /** JSON diagnostic endpoint (/capabilities, /identity): 200 -> parsed body, otherwise throws SszRestError. */
  async requestJson(path: string): Promise<unknown> {
    return this.send("GET", path, JSON_TYPE, {}, (res) => res.json());
  }

  /**
   * Retries transport-level failures the way the JSON-RPC client does, so enabling the
   * REST transport does not quietly make a call less resilient than it was. Retrying
   * happens inside the caller's queue slot, so #793's ordering rule still holds for
   * `newPayload` / `forkchoiceUpdated`.
   */
  private async send<T>(
    method: string,
    path: string,
    accept: string,
    opts: SszRequestOpts,
    read: (res: Response) => Promise<T>
  ): Promise<T> {
    return retry((_attempt) => this.sendOnce(method, path, accept, opts, read), {
      retries: opts.retries ?? this.retries,
      retryDelay: this.retryDelay,
      signal: this.signal,
      shouldRetry: isRetriableRestError,
    });
  }

  /**
   * Reads `read(res)` inside the same try/finally as `fetch()` so the abort timer also
   * bounds body consumption — a stalled 200/204 body is aborted just like a stalled
   * connection, instead of hanging forever once the timer is cleared.
   */
  private async sendOnce<T>(
    method: string,
    path: string,
    accept: string,
    opts: SszRequestOpts,
    read: (res: Response) => Promise<T>
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-Engine-Client-Version": this.clientVersionHeader,
    };
    if (opts.fork !== undefined) headers["Eth-Execution-Version"] = opts.fork;
    if (opts.body !== undefined) headers["Content-Type"] = OCTET_STREAM;
    if (this.jwtSecret) {
      // Per #793 authentication: `iat` required, `id` optional, `clv` removed.
      const claim: JwtClaim = {iat: Math.floor(Date.now() / 1000), id: this.jwtId};
      headers.Authorization = `Bearer ${encodeJwtToken(claim, this.jwtSecret)}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    // Abort on whichever comes first: the per-request timeout or node shutdown. Without
    // the shutdown signal an in-flight request outlives the queue drain and keeps the
    // process alive for up to `timeout`, unlike the JSON-RPC client which forwards it.
    const signal = this.signal ? AbortSignal.any([controller.signal, this.signal]) : controller.signal;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body ? (opts.body as unknown as BodyInit) : undefined,
        signal,
      });
      if (!res.ok) {
        throw await toSszRestError(res);
      }
      try {
        return await read(res);
      } catch (e) {
        // fetch() only wraps errors from the request itself; a body read that aborts
        // after headers arrived throws a raw DOMException here, not a FetchError.
        // Normalize it the same way so callers see one consistent timeout shape.
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new FetchError(`${this.baseUrl}${path}`, e);
        }
        throw e;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

async function toSszRestError(res: Response): Promise<SszRestError> {
  const text = await res.text().catch(() => "");
  let type: string | undefined;
  let detail: string | undefined = text || undefined;
  if (res.headers.get("content-type")?.includes("json")) {
    try {
      const problem = JSON.parse(text) as {type?: unknown; detail?: unknown};
      type = typeof problem.type === "string" ? problem.type : undefined;
      // Only override `detail` when the body actually carries an RFC 7807 `detail`
      // string; a JSON body that parses but isn't RFC 7807-shaped (e.g. a legacy
      // `{"code":N,"message":"..."}` error) keeps the raw text as its diagnostic.
      if (typeof problem.detail === "string") {
        detail = problem.detail;
      }
    } catch {
      // Not JSON at all; keep the raw text as detail.
    }
  }
  return new SszRestError(res.status, type, detail, res.statusText);
}

/**
 * Retry transport-level failures only: a network error, a timeout, or a 5xx the EL
 * reports as internal. A 4xx is semantic under #793's error model — unknown payload,
 * invalid forkchoice, unsupported fork — and means the same however many times we ask,
 * so retrying it would only delay surfacing a real bug. Deliberately stricter than the
 * JSON-RPC client, which retries on any error.
 */
function isRetriableRestError(e: Error): boolean {
  if (e instanceof SszRestError) {
    return e.status >= 500;
  }
  return true;
}
