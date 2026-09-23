import {FetchError, fetch, fromHex} from "@lodestar/utils";
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
}

export type SszRequestOpts = {
  /** Set only on fork-scoped endpoints; becomes `Eth-Execution-Version`. */
  fork?: ElForkName;
  body?: Uint8Array;
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

  constructor(opts: SszRestClientOpts) {
    this.baseUrl = opts.baseUrl;
    this.clientVersionHeader = opts.clientVersionHeader;
    this.jwtSecret = opts.jwtSecretHex ? fromHex(opts.jwtSecretHex) : undefined;
    this.jwtId = opts.jwtId;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
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
   * Reads `read(res)` inside the same try/finally as `fetch()` so the abort timer also
   * bounds body consumption — a stalled 200/204 body is aborted just like a stalled
   * connection, instead of hanging forever once the timer is cleared.
   */
  private async send<T>(
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
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body ? (opts.body as unknown as BodyInit) : undefined,
        signal: controller.signal,
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
