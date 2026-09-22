import {Logger} from "@lodestar/logger";
import {ForkName} from "@lodestar/params";
import {JsonRpcHttpClientEvent, JsonRpcHttpClientEventEmitter} from "./jsonRpcHttpClient.js";
import {SszRequestOpts, SszRestClient, SszRestError} from "./sszRestClient.js";
import {
  MAX_BLOBS_REQUEST,
  MAX_BODIES_REQUEST,
  MAX_REQUEST_BODY_SIZE,
  RestCapabilities,
  clForkToElFork,
  parseCapabilities,
  parseIdentity,
} from "./sszRestEncoding.js";
import {ClientVersionRpc} from "./types.js";

export interface SszRestEngineModules {
  logger: Logger;
  /** Shared with the JSON-RPC client so engine-state tracking sees both transports. */
  emitter: JsonRpcHttpClientEventEmitter;
}

const DEFAULT_LIMITS: RestCapabilities["limits"] = {
  bodiesMaxCount: MAX_BODIES_REQUEST,
  blobsMaxVersionedHashes: MAX_BLOBS_REQUEST,
  payloadMaxBytes: MAX_REQUEST_BODY_SIZE,
};

/**
 * SSZ-REST Engine API transport (ethereum/execution-apis#793).
 *
 * Probes `GET /engine/v1/capabilities` exactly once at construction and commits for
 * the process lifetime (refactor.md § Transition-window behavior): a 404, connection
 * failure, or malformed document disables REST; otherwise each fork-scoped call is
 * gated on `supported_forks` and each `/blobs/vN` call on the advertised revisions.
 * There is no per-request fallback and no re-probe.
 */
export class SszRestEngine {
  private readonly capabilities: Promise<RestCapabilities | null>;
  readonly ready: Promise<void>;

  constructor(
    private readonly client: SszRestClient,
    private readonly modules: SszRestEngineModules
  ) {
    this.capabilities = this.probe();
    this.ready = this.capabilities.then(() => undefined);
  }

  async isAvailable(): Promise<boolean> {
    return (await this.capabilities) !== null;
  }

  async supportsFork(fork: ForkName): Promise<boolean> {
    const caps = await this.capabilities;
    if (caps === null) return false;
    try {
      return caps.supportedForks.has(clForkToElFork(fork));
    } catch {
      return false; // pre-merge fork: no Engine API at all
    }
  }

  async supportsBlobs(revision: number): Promise<boolean> {
    return (await this.capabilities)?.blobRevisions.has(revision) ?? false;
  }

  async limits(): Promise<RestCapabilities["limits"]> {
    return (await this.capabilities)?.limits ?? DEFAULT_LIMITS;
  }

  /** `GET /engine/v1/identity` — same shape as `engine_getClientVersionV1`'s result. */
  async identity(): Promise<ClientVersionRpc[]> {
    return parseIdentity(await this.json("/engine/v1/identity"));
  }

  private async probe(): Promise<RestCapabilities | null> {
    try {
      const caps = parseCapabilities(await this.client.requestJson("/engine/v1/capabilities"));
      this.modules.logger.info("SSZ-REST Engine API available", {
        forks: [...caps.supportedForks].join(","),
        blobs: [...caps.blobRevisions].map((v) => `v${v}`).join(","),
      });
      return caps;
    } catch (e) {
      this.modules.logger.info("SSZ-REST Engine API not available, using JSON-RPC", {
        reason: (e as Error).message,
      });
      return null;
    }
  }

  // Wrappers that mirror JsonRpcHttpClient's event emission so `updateEngineState`
  // and the first-response hook in ExecutionEngineHttp fire for both transports.

  protected async ssz(method: "GET" | "POST", path: string, opts?: SszRequestOpts): Promise<Uint8Array | null> {
    try {
      const response = await this.client.requestSsz(method, path, opts);
      this.modules.emitter.emit(JsonRpcHttpClientEvent.RESPONSE, {payload: path, response});
      return response;
    } catch (error) {
      this.logRestError(path, opts?.fork, error);
      this.modules.emitter.emit(JsonRpcHttpClientEvent.ERROR, {payload: path, error: error as Error});
      throw error;
    }
  }

  protected async json(path: string): Promise<unknown> {
    try {
      const response = await this.client.requestJson(path);
      this.modules.emitter.emit(JsonRpcHttpClientEvent.RESPONSE, {payload: path, response});
      return response;
    } catch (error) {
      this.logRestError(path, undefined, error);
      this.modules.emitter.emit(JsonRpcHttpClientEvent.ERROR, {payload: path, error: error as Error});
      throw error;
    }
  }

  /** refactor.md § Error model — statuses that indicate a negotiation or codec bug get louder logs. */
  private logRestError(path: string, fork: string | undefined, error: unknown): void {
    if (!(error instanceof SszRestError)) return;
    const ctx = {path, fork: fork ?? "-", status: error.status, type: error.type ?? "-"};
    switch (error.type) {
      case "/engine-api/errors/unsupported-fork":
        this.modules.logger.warn("SSZ-REST fork rejected despite being advertised", ctx);
        break;
      case "/engine-api/errors/method-not-found":
        this.modules.logger.warn("SSZ-REST endpoint disappeared; restart to re-negotiate", ctx);
        break;
      case "/engine-api/errors/ssz-decode-error":
      case "/engine-api/errors/unsupported-media-type":
      case "/engine-api/errors/request-too-large":
        this.modules.logger.error("SSZ-REST request rejected by EL (codec or limits mismatch)", ctx);
        break;
      default:
        this.modules.logger.debug("SSZ-REST request failed", ctx);
    }
  }
}
