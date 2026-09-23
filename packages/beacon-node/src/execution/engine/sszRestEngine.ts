import {Logger} from "@lodestar/logger";
import {ForkName, ForkSeq} from "@lodestar/params";
import {ExecutionPayload, ExecutionRequests, RootHex} from "@lodestar/types";
import type {BlobAndProof} from "@lodestar/types/deneb";
import type {BlobAndProofV2} from "@lodestar/types/fulu";
import {fromHex} from "@lodestar/utils";
import {PayloadAttributes} from "./interface.js";
import {JsonRpcHttpClientEvent, JsonRpcHttpClientEventEmitter} from "./jsonRpcHttpClient.js";
import {PayloadId} from "./payloadIdCache.js";
import {SszRequestOpts, SszRestClient, SszRestError} from "./sszRestClient.js";
import {
  DecodedBuiltPayload,
  DecodedForkchoiceUpdateResponse,
  DecodedPayloadStatus,
  MAX_BLOBS_REQUEST,
  MAX_BODIES_REQUEST,
  MAX_REQUEST_BODY_SIZE,
  RestCapabilities,
  clForkToElFork,
  decodeBlobsV1Response,
  decodeBlobsV2Response,
  decodeBodiesResponse,
  decodeBuiltPayload,
  decodeForkchoiceUpdateResponse,
  decodePayloadStatus,
  encodeBlobsRequest,
  encodeBodiesByHashRequest,
  encodeForkchoiceUpdate,
  encodeNewPayload,
  parseCapabilities,
  parseIdentity,
} from "./sszRestEncoding.js";
import {ClientVersionRpc, ExecutionPayloadBody} from "./types.js";

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

  constructor(
    private readonly client: SszRestClient,
    private readonly modules: SszRestEngineModules
  ) {
    this.capabilities = this.probe();
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
    if ((await this.capabilities) === null) {
      throw Error("SSZ-REST Engine API not available");
    }
    return parseIdentity(await this.json("/engine/v1/identity"));
  }

  /** `POST /engine/v1/payloads` — refactor.md § Payload submission. */
  async newPayload(
    fork: ForkName,
    executionPayload: ExecutionPayload,
    parentBeaconBlockRoot?: Uint8Array,
    executionRequests?: ExecutionRequests
  ): Promise<DecodedPayloadStatus> {
    const body = encodeNewPayload(fork, executionPayload, parentBeaconBlockRoot, executionRequests);
    const resp = await this.sszRequired("POST", "/engine/v1/payloads", {fork: clForkToElFork(fork), body});
    return decodePayloadStatus(resp);
  }

  /** `POST /engine/v1/forkchoice` — refactor.md § Forkchoice update. */
  async forkchoiceUpdated(
    fork: ForkName,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    attributes?: PayloadAttributes
  ): Promise<DecodedForkchoiceUpdateResponse> {
    const body = encodeForkchoiceUpdate(
      fork,
      fromHex(headBlockHash),
      fromHex(safeBlockHash),
      fromHex(finalizedBlockHash),
      attributes
    );
    const resp = await this.sszRequired("POST", "/engine/v1/forkchoice", {fork: clForkToElFork(fork), body});
    return decodeForkchoiceUpdateResponse(resp);
  }

  /** `GET /engine/v1/payloads/{payloadId}` — refactor.md § Payload retrieval. */
  async getPayload(fork: ForkName, payloadId: PayloadId): Promise<DecodedBuiltPayload> {
    if (!/^0x[0-9a-f]{16}$/i.test(payloadId)) {
      throw Error(`Invalid payloadId=${payloadId}`);
    }
    const resp = await this.sszRequired("GET", `/engine/v1/payloads/${payloadId}`, {fork: clForkToElFork(fork)});
    return decodeBuiltPayload(fork, resp);
  }

  /**
   * `POST /engine/v1/bodies/hash` — refactor.md § Historical bodies. The fork header
   * selects both the body schema and the block era: hashes outside `fork`'s era come
   * back `available=false` -> null.
   */
  async bodiesByHash(fork: ForkName, blockHashes: RootHex[]): Promise<(ExecutionPayloadBody | null)[]> {
    const body = encodeBodiesByHashRequest(blockHashes.map((h) => fromHex(h)));
    const resp = await this.sszRequired("POST", "/engine/v1/bodies/hash", {fork: clForkToElFork(fork), body});
    return decodeBodiesResponse(fork, resp);
  }

  /** `GET /engine/v1/bodies?from=N&count=M` — range past head is truncated, not padded. */
  async bodiesByRange(fork: ForkName, start: number, count: number): Promise<(ExecutionPayloadBody | null)[]> {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0) {
      throw Error(`Invalid bodies range start=${start} count=${count}`);
    }
    const resp = await this.sszRequired("GET", `/engine/v1/bodies?from=${start}&count=${count}`, {
      fork: clForkToElFork(fork),
    });
    return decodeBodiesResponse(fork, resp);
  }

  /**
   * `/blobs/vN` revision Lodestar uses for a fork: v1 (whole-blob proof) pre-Fulu,
   * v2 (cell proofs) from Fulu.
   *
   * `null` when the fork has no EL fork name. `/blobs/vN` is unscoped, so nothing in
   * the request depends on the mapping — but a fork this transport cannot name is one
   * whose blob semantics it cannot vouch for, and every other method already falls to
   * JSON-RPC for such a fork. Returning `null` keeps blobs consistent with them
   * instead of silently putting an unmapped fork on half the REST surface.
   */
  static blobsRevision(fork: ForkName): 1 | 2 | null {
    try {
      clForkToElFork(fork);
    } catch {
      return null;
    }
    return ForkSeq[fork] >= ForkSeq.fulu ? 2 : 1;
  }

  /** `POST /engine/v1/blobs/v1` — partial responses; 204 = EL cannot serve (all null, as JSON-RPC v1 callers expect). */
  async blobsV1(versionedHashes: Uint8Array[]): Promise<(BlobAndProof | null)[]> {
    const resp = await this.ssz("POST", "/engine/v1/blobs/v1", {body: encodeBlobsRequest(versionedHashes)});
    if (resp === null) return versionedHashes.map(() => null);
    const out = decodeBlobsV1Response(resp);
    if (out.length !== versionedHashes.length) {
      throw Error(`Invalid /blobs/v1 response length=${out.length} versionedHashes=${versionedHashes.length}`);
    }
    return out;
  }

  /** `POST /engine/v1/blobs/v2` — all-or-nothing; 204 = null (matches `engine_getBlobsV2`). */
  async blobsV2(versionedHashes: Uint8Array[], buffers?: Uint8Array[]): Promise<BlobAndProofV2[] | null> {
    const resp = await this.ssz("POST", "/engine/v1/blobs/v2", {body: encodeBlobsRequest(versionedHashes)});
    if (resp === null) return null;
    const out = decodeBlobsV2Response(resp, buffers);
    if (out.length !== versionedHashes.length) {
      throw Error(`Invalid /blobs/v2 response length=${out.length} versionedHashes=${versionedHashes.length}`);
    }
    return out;
  }

  /** Like `ssz()` but 204 is a protocol violation: only `/blobs/vN` may return it. */
  private async sszRequired(method: "GET" | "POST", path: string, opts?: SszRequestOpts): Promise<Uint8Array> {
    const resp = await this.ssz(method, path, opts);
    if (resp === null) {
      throw new SszRestError(204, undefined, "unexpected empty response", "No Content");
    }
    return resp;
  }

  private async probe(): Promise<RestCapabilities | null> {
    try {
      // Deliberately uses `this.client` directly, not `this.json()`: negotiation
      // failures (404 from a legacy JSON-RPC-only EL, connection refused, malformed
      // body) are a normal outcome here, not an engine call failure, and must not
      // feed `this.modules.emitter` — emitting ERROR would make
      // ExecutionEngineHttp.updateEngineState flip to SYNCING/OFFLINE against an
      // otherwise healthy EL that simply doesn't speak SSZ-REST.
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

  private async ssz(method: "GET" | "POST", path: string, opts?: SszRequestOpts): Promise<Uint8Array | null> {
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

  private async json(path: string): Promise<unknown> {
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
