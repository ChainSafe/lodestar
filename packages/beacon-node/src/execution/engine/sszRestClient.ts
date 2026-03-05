import {fetch, isFetchError} from "@lodestar/utils";
import {JwtClaim, encodeJwtToken} from "./jwt.js";
import {HTTP_CONNECTION_ERROR_CODES, HTTP_FATAL_ERROR_CODES} from "./utils.js";

export interface SszRestClientOpts {
  baseUrl: string;
  jwtSecretHex?: string;
  jwtId?: string;
  jwtVersion?: string;
  /** Request timeout in milliseconds. Defaults to 12000 */
  timeout?: number;
}

/**
 * Error thrown when the SSZ-REST endpoint returns a non-200 response.
 * The EL returns JSON error bodies of the form {"code": N, "message": "..."}.
 */
export class SszRestError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(`SSZ-REST error ${code}: ${message}`);
    this.code = code;
  }
}

/**
 * Determines whether an error is a network-level error (DNS failure, connection
 * refused, timeout, etc.) that should trigger a fallback to JSON-RPC rather than
 * being propagated directly to the caller.
 */
export function isSszRestNetworkError(e: unknown): boolean {
  if (e instanceof SszRestError) {
    // HTTP errors from the SSZ-REST endpoint (e.g. 404) indicate the
    // endpoint doesn't support this path — fall back to JSON-RPC.
    return true;
  }
  // Node.js fetch errors (ECONNREFUSED, ENOTFOUND, etc.)
  if (isFetchError(e)) {
    const allCodes = [...HTTP_FATAL_ERROR_CODES, ...HTTP_CONNECTION_ERROR_CODES];
    return allCodes.includes((e as {code: string}).code);
  }
  // TypeError is thrown by fetch on DNS resolution failure in some runtimes
  if (e instanceof TypeError) {
    return true;
  }
  // AbortError from timeout
  if (e instanceof DOMException && e.name === "AbortError") {
    return true;
  }
  return false;
}

const DEFAULT_TIMEOUT = 12_000;

/**
 * SSZ-REST HTTP client for EIP-8161 Engine API transport.
 *
 * Sends binary (application/octet-stream) POST requests and receives binary
 * responses. JWT authentication is supported identically to the JSON-RPC client.
 */
export class SszRestClient {
  private readonly baseUrl: string;
  private readonly jwtSecret: Uint8Array | undefined;
  private readonly jwtId: string | undefined;
  private readonly jwtVersion: string | undefined;
  private readonly timeout: number;

  constructor(opts: SszRestClientOpts) {
    // Strip trailing slash for consistent path joining
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.jwtSecret = opts.jwtSecretHex ? hexToBytes(opts.jwtSecretHex) : undefined;
    this.jwtId = opts.jwtId;
    this.jwtVersion = opts.jwtVersion;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * POST binary body to `baseUrl + path` and return the response as Uint8Array.
   *
   * - Content-Type: application/octet-stream
   * - Authorization: Bearer <jwt> (when jwtSecret is configured)
   * - On 200: returns response body as Uint8Array
   * - On non-200: attempts to parse JSON error body and throws SszRestError
   */
  async doRequest(path: string, body: Uint8Array): Promise<Uint8Array> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
      };

      if (this.jwtSecret) {
        const jwtClaim: JwtClaim = {
          iat: Math.floor(Date.now() / 1000),
          id: this.jwtId,
          clv: this.jwtVersion,
        };
        const token = encodeJwtToken(jwtClaim, this.jwtSecret);
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        method: "POST",
        body: body as unknown as BodyInit,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        // Try to parse JSON error from EL
        let code = res.status;
        let message = res.statusText;
        // Read body as text first, then try to parse as JSON
        const bodyText = await res.text().catch(() => "");
        if (bodyText) {
          try {
            const errJson = JSON.parse(bodyText) as {code?: number; message?: string};
            if (errJson.code !== undefined) code = errJson.code;
            if (errJson.message !== undefined) message = errJson.message;
          } catch {
            message = bodyText.slice(0, 500);
          }
        }
        throw new SszRestError(code, message);
      }

      const arrayBuf = await res.arrayBuffer();
      return new Uint8Array(arrayBuf);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Convert a hex string (with or without 0x prefix) to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(stripped.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
