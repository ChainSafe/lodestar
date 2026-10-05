import {Logger} from "@lodestar/logger";
import {
  ForkName,
  ForkPostFulu,
  ForkPreFulu,
  ForkSeq,
  SLOTS_PER_EPOCH,
  isForkPostBellatrix,
  isForkPostFulu,
} from "@lodestar/params";
import {BlobsBundle, ExecutionPayload, ExecutionRequests, Root, RootHex, Wei} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {BlobAndProofV2} from "@lodestar/types/fulu";
import {isErrorAborted} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {EPOCHS_PER_BATCH} from "../../sync/constants.js";
import {getLodestarClientVersion} from "../../util/metadata.js";
import {isQueueErrorAborted} from "../../util/queue/errors.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {isValidBlobVersionedHashes} from "./blobVersionedHashes.js";
import {
  ClientVersion,
  ExecutePayloadResponse,
  ExecutionEngineState,
  ExecutionPayloadStatus,
  IExecutionEngine,
  PayloadAttributes,
  PayloadId,
  VersionedHashes,
} from "./interface.js";
import {ErrorJsonRpcResponse, HttpRpcError, JsonRpcHttpClientEvent} from "./jsonRpcHttpClient.js";
import {PayloadIdCache} from "./payloadIdCache.js";
import {
  EngineRestContentTypeError,
  EngineRestError,
  EngineRestResponseError,
  isRetryableEngineRestError,
} from "./restHttpClient.js";
import {EngineCapabilities, RestEngineTransport} from "./restTransport.js";
import {executionForkName} from "./sszTypes.js";
import {IEngineTransport, PayloadStatusResult} from "./transport.js";
import {ExecutionPayloadBody, ExecutionPayloadBodyV2, serializePayloadAttributes} from "./types.js";
import {getExecutionEngineState} from "./utils.js";

export type ExecutionEngineModules = {
  signal: AbortSignal;
  metrics?: Metrics | null;
  logger: Logger;
};

/**
 * Engine API transport selection
 * - `auto`: negotiate REST with one execution URL; use JSON-RPC for multiple URLs or unadvertised features
 * - `ssz`: always use the REST API with SSZ encoding
 * - `json-rpc`: always use the legacy JSON-RPC API
 */
export type EngineApiMode = "auto" | "ssz" | "json-rpc";
export const engineApiModes: EngineApiMode[] = ["auto", "ssz", "json-rpc"];

export type ExecutionEngineHttpOpts = {
  urls: string[];
  retries: number;
  retryDelay: number;
  timeout?: number;
  engineApi?: EngineApiMode;
  /**
   * 256 bit jwt secret in hex format without the leading 0x. If provided, the execution engine
   * rpc requests will be bundled by an authorization header having a fresh jwt token on each
   * request, as the EL auth specs mandate the fresh of the token (iat) to be checked within
   * +-5 seconds interval.
   */
  jwtSecretHex?: string;
  /**
   * An identifier string passed as CLI arg that will be set in `id` field of jwt claims
   */
  jwtId?: string;
  /**
   * A version string that will be set in `clv` field of jwt claims
   */
  jwtVersion?: string;
  /**
   * Lodestar version to be used for `ClientVersion`
   */
  version?: string;
  /**
   * Lodestar commit to be used for `ClientVersion`
   */
  commit?: string;
};

export const defaultExecutionEngineHttpOpts: ExecutionEngineHttpOpts = {
  /**
   * By default ELs host engine api on an auth protected 8551 port, would need a jwt secret to be
   * specified to bundle jwt tokens if that is the case. In case one has access to an open
   * port/url, one can override this and skip providing a jwt secret.
   */
  urls: ["http://localhost:8551"],
  retries: 2,
  retryDelay: 2000,
  timeout: 12000,
  engineApi: "auto",
};

export type ExecutionEngineTransports = {
  jsonRpc: IEngineTransport;
  rest?: RestEngineTransport;
};

type RestSupport =
  | {state: "pending"; error?: Error}
  | {state: "unsupported"}
  | {state: "supported"; capabilities: EngineCapabilities};

/**
 * Size for the serializing queue for fcUs and new payloads, the max length could be equal to
 * EPOCHS_PER_BATCH * 2 in case new payloads are also not awaited serially
 */
const QUEUE_MAX_LENGTH = EPOCHS_PER_BATCH * SLOTS_PER_EPOCH * 2;

/** Minimum delay between capabilities probes while the execution client is unreachable */
const REST_PROBE_RETRY_MS = 12_000;

/**
 * Drives the execution client over the engine API, either the legacy `engine_*` JSON-RPC methods
 * or the REST API with SSZ encoded bodies.
 * https://github.com/ethereum/execution-apis/tree/main/src/engine
 *
 * In `auto` mode a capabilities response from a server without the REST API, a 4xx other than
 * 401/403 or a success that is not JSON, selects JSON-RPC until the EL reconnects. Transient
 * discovery failures use JSON-RPC while awaiting another probe; authentication failures and
 * malformed capabilities fail visibly. Forks and blob revisions the EL does not advertise also use
 * JSON-RPC.
 */
export class ExecutionEngineHttp implements IExecutionEngine {
  private logger: Logger;
  private metrics: Metrics | null;

  // The default state is ONLINE, it will be updated to SYNCING once we receive the first payload
  // This assumption is better than the OFFLINE state, since we can't be sure if the EL is offline and being offline may trigger some notifications
  // It's safer to to avoid false positives and assume that the EL is syncing until we receive the first payload
  state: ExecutionEngineState = ExecutionEngineState.ONLINE;

  /** Cached EL client version from the latest getClientVersion call */
  clientVersion?: ClientVersion | null;

  readonly payloadIdCache = new PayloadIdCache();
  /**
   * A queue to serialize the fcUs and newPayloads calls:
   *
   * While syncing, lodestar has a batch processing module which calls new payloads in batch followed by fcUs.
   * Even though we await for responses to new payloads serially, we just trigger fcUs consecutively. This
   * may lead to the EL receiving the fcUs out of the order and may break the EL's backfill/beacon sync. Since
   * the order of new payloads and fcUs is pretty important to EL, this queue will serialize the calls in the
   * order with which we make them.
   */
  private readonly queue: JobItemQueue<[() => Promise<unknown>], unknown>;

  private readonly jsonRpc: IEngineTransport;
  private readonly rest: RestEngineTransport | null;
  private readonly engineApi: EngineApiMode;
  private restSupport: RestSupport = {state: "pending"};
  private restProbe: Promise<RestSupport> | null = null;
  private lastRestProbeMs = Number.NEGATIVE_INFINITY;
  private readonly loggedRestFallbacks = new Set<ForkName | "v1" | "v2">();

  constructor(
    {jsonRpc, rest}: ExecutionEngineTransports,
    {metrics, signal, logger}: ExecutionEngineModules,
    private readonly opts?: ExecutionEngineHttpOpts
  ) {
    this.queue = new JobItemQueue<[() => Promise<unknown>], unknown>(
      (job) => job(),
      {maxLength: QUEUE_MAX_LENGTH, maxConcurrency: 1, noYieldIfOneItem: true, signal},
      metrics?.engineHttpProcessorQueue
    );
    this.logger = logger;
    this.metrics = metrics ?? null;
    this.jsonRpc = jsonRpc;
    this.rest = rest ?? null;
    this.engineApi = opts?.engineApi ?? "auto";
    this.metrics?.engineApiTransport.set({transport: "ssz"}, 0);
    this.metrics?.engineApiTransport.set({transport: "json-rpc"}, 0);

    if (this.engineApi === "ssz" && this.rest === null) {
      throw Error("REST transport is required for engineApi=ssz");
    }

    // REST errors are handled in withTransport after compatibility fallback.
    this.jsonRpc.emitter.on(JsonRpcHttpClientEvent.ERROR, ({error}) => {
      this.updateEngineState(getExecutionEngineState({payloadError: error, oldState: this.state}), error);
    });

    for (const transport of [this.jsonRpc, this.rest]) {
      transport?.emitter.on(JsonRpcHttpClientEvent.RESPONSE, () => {
        if (this.clientVersion === undefined) {
          this.clientVersion = null;
          // This statement should only be called first time receiving response after startup
          this.getClientVersion(getLodestarClientVersion(this.opts)).catch((e) => {
            this.logger.debug("Unable to get execution client version", {}, e);
          });
        }
        this.updateEngineState(
          getExecutionEngineState({targetState: ExecutionEngineState.ONLINE, oldState: this.state})
        );
      });
    }
  }

  /**
   * `engine_newPayloadV1`
   * From: https://github.com/ethereum/execution-apis/blob/v1.0.0-alpha.6/src/engine/specification.md#engine_newpayloadv1
   *
   * Client software MUST respond to this method call in the following way:
   *
   *   1. {status: INVALID_BLOCK_HASH, latestValidHash: null, validationError:
   *      errorMessage | null} if the blockHash validation has failed
   *
   *   2. {status: SYNCING, latestValidHash: null, validationError: null} if the payload
   *      extends the canonical chain and requisite data for its validation is missing
   *      with the payload status obtained from the Payload validation process if the payload
   *      has been fully validated while processing the call
   *
   *   3. {status: ACCEPTED, latestValidHash: null, validationError: null} if the
   *      following conditions are met:
   *        i) the blockHash of the payload is valid
   *        ii) the payload doesn't extend the canonical chain
   *        iii) the payload hasn't been fully validated.
   *
   * If any of the above fails due to errors unrelated to the normal processing flow of the method, client software MUST respond with an error object.
   */
  async notifyNewPayload(
    fork: ForkName,
    executionPayload: ExecutionPayload,
    versionedHashes?: VersionedHashes,
    parentBlockRoot?: Root,
    executionRequests?: ExecutionRequests
  ): Promise<ExecutePayloadResponse> {
    // Validate before queueing, argument errors must not be reported as an unavailable execution client
    if (ForkSeq[fork] >= ForkSeq.deneb) {
      if (versionedHashes === undefined) {
        throw Error(`versionedHashes required in notifyNewPayload for fork=${fork}`);
      }
      if (parentBlockRoot === undefined) {
        throw Error(`parentBlockRoot required in notifyNewPayload for fork=${fork}`);
      }
      if (ForkSeq[fork] >= ForkSeq.electra && executionRequests === undefined) {
        throw Error(`executionRequests required in notifyNewPayload for fork=${fork}`);
      }
      if (!isValidBlobVersionedHashes(executionPayload.transactions, versionedHashes)) {
        return {
          status: ExecutionPayloadStatus.INVALID,
          latestValidHash: null,
          validationError: "Payload blob versioned hashes do not match the beacon commitments",
        };
      }
    }

    let result: PayloadStatusResult;
    try {
      result = await this.enqueue(() =>
        this.withTransport(fork, undefined, (transport) =>
          transport.newPayload(fork, executionPayload, versionedHashes, parentBlockRoot, executionRequests)
        )
      );
    } catch (e) {
      const status = isEngineResponseError(e as Error)
        ? ExecutionPayloadStatus.ELERROR
        : ExecutionPayloadStatus.UNAVAILABLE;
      // Only newPayload treats an unreachable execution client, including a timeout, as offline
      const newState =
        status === ExecutionPayloadStatus.UNAVAILABLE && !isErrorAborted(e) && !isQueueErrorAborted(e)
          ? getExecutionEngineState({payloadStatus: status, oldState: this.state})
          : getExecutionEngineState({payloadError: e, oldState: this.state});
      this.updateEngineState(newState, e as Error);
      return {status, latestValidHash: null, validationError: (e as Error).message};
    }
    const {status, latestValidHash, validationError} = result;

    this.updateEngineState(getExecutionEngineState({payloadStatus: status, oldState: this.state}));

    switch (status) {
      case ExecutionPayloadStatus.VALID:
        return {status, latestValidHash: latestValidHash ?? "0x0", validationError: null};

      case ExecutionPayloadStatus.INVALID:
        // As per latest specs if latestValidHash can be null and it would mean only
        // invalidate this block
        return {status, latestValidHash, validationError};

      case ExecutionPayloadStatus.SYNCING:
      case ExecutionPayloadStatus.ACCEPTED:
        return {status, latestValidHash: null, validationError: null};

      case ExecutionPayloadStatus.INVALID_BLOCK_HASH:
        return {status, latestValidHash: null, validationError: validationError ?? "Malformed block"};

      case ExecutionPayloadStatus.UNAVAILABLE:
      case ExecutionPayloadStatus.ELERROR:
        return {
          status,
          latestValidHash: null,
          validationError: validationError ?? "Unknown ELERROR",
        };

      default:
        return {
          status: ExecutionPayloadStatus.ELERROR,
          latestValidHash: null,
          validationError: `Invalid EL status on executePayload: ${status}`,
        };
    }
  }

  /**
   * `engine_forkchoiceUpdatedV1`
   * From: https://github.com/ethereum/execution-apis/blob/v1.0.0-alpha.6/src/engine/specification.md#engine_forkchoiceupdatedv1
   *
   * Client software MUST respond to this method call in the following way:
   *
   *   1. {payloadStatus: {status: SYNCING, latestValidHash: null, validationError: null}
   *      , payloadId: null}
   *      if forkchoiceState.headBlockHash references an unknown payload or a payload that
   *      can't be validated because requisite data for the validation is missing
   *
   *   2. {payloadStatus: {status: INVALID, latestValidHash: null, validationError:
   *      errorMessage | null}, payloadId: null}
   *      obtained from the Payload validation process if the payload is deemed INVALID
   *
   *   3. {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash,
   *      validationError: null}, payloadId: null}
   *      if the payload is deemed VALID and a build process hasn't been started
   *
   *   4. {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash,
   *      validationError: null}, payloadId: buildProcessId}
   *      if the payload is deemed VALID and the build process has begun.
   *
   * If any of the above fails due to errors unrelated to the normal processing flow of the method, client software MUST respond with an error object.
   */
  async notifyForkchoiceUpdate(
    fork: ForkName,
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<PayloadId | null> {
    const {
      payloadStatus: {status, validationError},
      payloadId,
    } = await this.enqueue(() =>
      this.withTransport(fork, undefined, (transport) =>
        transport.forkchoiceUpdated(fork, headBlockHash, safeBlockHash, finalizedBlockHash, payloadAttributes)
      )
    );

    this.updateEngineState(getExecutionEngineState({payloadStatus: status, oldState: this.state}));
    this.metrics?.engineNotifyForkchoiceUpdateResult.inc({result: status});

    switch (status) {
      case ExecutionPayloadStatus.VALID:
        // if payloadAttributes are provided, a valid payloadId is expected
        if (payloadAttributes) {
          if (payloadId === null) {
            throw Error(`Received invalid payloadId=${payloadId}`);
          }

          const payloadAttributesRpc = serializePayloadAttributes(payloadAttributes);
          this.payloadIdCache.add({headBlockHash, finalizedBlockHash, ...payloadAttributesRpc}, payloadId);
          void this.prunePayloadIdCache();
        }
        return payloadId;

      case ExecutionPayloadStatus.SYNCING:
        // Throw error on syncing if requested to produce a block, else silently ignore
        if (payloadAttributes) {
          throw Error("Execution Layer Syncing");
        }
        return null;

      case ExecutionPayloadStatus.INVALID:
        throw Error(
          `Invalid ${payloadAttributes ? "prepare payload" : "forkchoice request"}, validationError=${
            validationError ?? ""
          }`
        );

      default:
        throw Error(`Unknown status ${status}`);
    }
  }

  /**
   * `engine_getPayloadV1`
   *
   * 1. Given the payloadId client software MUST respond with the most recent version of the payload that is available in the corresponding building process at the time of receiving the call.
   * 2. The call MUST be responded with 5: Unavailable payload error if the building process identified by the payloadId doesn't exist.
   * 3. Client software MAY stop the corresponding building process after serving this call.
   */
  async getPayload(
    fork: ForkName,
    payloadId: PayloadId
  ): Promise<{
    executionPayload: ExecutionPayload;
    executionPayloadValue: Wei;
    blobsBundle?: BlobsBundle;
    executionRequests?: ExecutionRequests;
    shouldOverrideBuilder?: boolean;
  }> {
    return this.withTransport(fork, undefined, (transport) => transport.getPayload(fork, payloadId));
  }

  async prunePayloadIdCache(): Promise<void> {
    this.payloadIdCache.prune();
  }

  async getPayloadBodiesByHash(fork: ForkName, blockHashes: RootHex[]): Promise<(ExecutionPayloadBody | null)[]> {
    return this.withTransport(fork, undefined, (transport) => transport.getPayloadBodiesByHash(fork, blockHashes));
  }

  async getPayloadBodiesByHashV2(blockHashes: RootHex[]): Promise<(ExecutionPayloadBodyV2 | null)[]> {
    return this.withTransport(ForkName.gloas, undefined, (transport) =>
      transport.getPayloadBodiesByHashV2(blockHashes)
    );
  }

  async getPayloadBodiesByRange(
    fork: ForkName,
    startBlockNumber: number,
    blockCount: number
  ): Promise<(ExecutionPayloadBody | null)[]> {
    return this.withTransport(fork, undefined, (transport) =>
      transport.getPayloadBodiesByRange(fork, startBlockNumber, blockCount)
    );
  }

  async getBlobs(
    fork: ForkPostFulu,
    versionedHashes: VersionedHashes,
    buffers?: Uint8Array[]
  ): Promise<BlobAndProofV2[] | null>;
  async getBlobs(
    fork: ForkPreFulu,
    versionedHashes: VersionedHashes,
    buffers?: Uint8Array[]
  ): Promise<(BlobAndProof | null)[]>;
  async getBlobs(
    fork: ForkName,
    versionedHashes: VersionedHashes,
    buffers?: Uint8Array[]
  ): Promise<BlobAndProofV2[] | (BlobAndProof | null)[] | null> {
    if (isForkPostFulu(fork)) {
      return this.withTransport(undefined, "v2", (transport) => transport.getBlobsV2(versionedHashes, buffers));
    }
    return this.withTransport(undefined, "v1", (transport) => transport.getBlobsV1(versionedHashes));
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    return this.queue.push(job) as Promise<T>;
  }

  /**
   * Run a call on the selected transport. An execution client that advertises a fork in its
   * capabilities but rejects it with `unsupported-fork` is not spec compliant, keep the node
   * functional by serving that fork over JSON-RPC from then on.
   */
  private async withTransport<T>(
    fork: ForkName | undefined,
    blobsRevision: "v1" | "v2" | undefined,
    fn: (transport: IEngineTransport) => Promise<T>
  ): Promise<T> {
    const transport = await this.getTransport(fork, blobsRevision);
    this.metrics?.engineApiTransport.set({transport: transport === this.rest ? "ssz" : "json-rpc"}, 1);
    try {
      return await fn(transport);
    } catch (e) {
      if (fork !== undefined && transport === this.rest && this.engineApi === "auto" && isUnsupportedForkError(e)) {
        this.disableRestForFork(fork, e);
        this.metrics?.engineApiTransport.set({transport: "json-rpc"}, 1);
        return fn(this.jsonRpc);
      }
      if (transport === this.rest) {
        this.updateEngineState(getExecutionEngineState({payloadError: e, oldState: this.state}), e as Error);
      }
      throw e;
    }
  }

  private disableRestForFork(fork: ForkName, e: EngineRestError): void {
    const executionFork = isForkPostBellatrix(fork) ? executionForkName[fork] : null;
    if (this.restSupport.state === "supported" && executionFork !== null) {
      this.restSupport.capabilities.supportedForks.delete(executionFork);
    }
    if (!this.loggedRestFallbacks.has(fork)) {
      this.loggedRestFallbacks.add(fork);
      this.logger.debug("REST engine API rejected an advertised fork, using JSON-RPC until reconnect", {
        fork,
        executionFork,
        status: e.status,
        type: e.type,
        detail: e.detail,
      });
    }
  }

  /**
   * Pick the transport for a call. Fork-scoped calls only go over REST if the execution client
   * advertises that fork, blob requests only if it serves the needed `/blobs/vN` revision.
   */
  private async getTransport(fork?: ForkName, blobsRevision?: "v1" | "v2"): Promise<IEngineTransport> {
    if (this.rest === null || this.engineApi === "json-rpc") {
      return this.jsonRpc;
    }
    const restSupport = await this.probeRestSupport(this.rest);
    if (restSupport.state === "pending" && restSupport.error) {
      this.updateEngineState(
        getExecutionEngineState({payloadError: restSupport.error, oldState: this.state}),
        restSupport.error
      );
      throw restSupport.error;
    }
    if (this.engineApi === "ssz") {
      return this.rest;
    }
    if (restSupport.state !== "supported") {
      return this.jsonRpc;
    }

    if (fork !== undefined) {
      const executionFork = isForkPostBellatrix(fork) ? executionForkName[fork] : null;
      if (executionFork === null || !restSupport.capabilities.supportedForks.has(executionFork)) {
        if (!this.loggedRestFallbacks.has(fork)) {
          this.loggedRestFallbacks.add(fork);
          this.logger.debug("Using JSON-RPC for a fork not advertised by the REST engine API", {fork, executionFork});
        }
        return this.jsonRpc;
      }
    }
    if (blobsRevision !== undefined && !restSupport.capabilities.blobsRevisions.has(blobsRevision)) {
      if (!this.loggedRestFallbacks.has(blobsRevision)) {
        this.loggedRestFallbacks.add(blobsRevision);
        this.logger.debug("Using JSON-RPC for a blob revision not advertised by the REST engine API", {blobsRevision});
      }
      return this.jsonRpc;
    }

    return this.rest;
  }

  private probeRestSupport(rest: RestEngineTransport): Promise<RestSupport> {
    if (this.restSupport.state !== "pending") {
      return Promise.resolve(this.restSupport);
    }
    if (this.restProbe !== null) {
      return this.restProbe;
    }
    // Transport errors keep the probe pending, do not retry on every call while the EL is down
    if (Date.now() - this.lastRestProbeMs < REST_PROBE_RETRY_MS) {
      return Promise.resolve(this.restSupport);
    }

    this.restProbe = rest
      .getCapabilities()
      .then(
        (capabilities): RestSupport => {
          this.restSupport = {state: "supported", capabilities};
          this.loggedRestFallbacks.clear();
          this.logger.debug("Discovered REST engine API capabilities", {
            supportedForks: Array.from(capabilities.supportedForks).join(","),
            blobsRevisions: Array.from(capabilities.blobsRevisions).join(","),
            ...capabilities.limits,
          });
          return this.restSupport;
        },
        (e: Error): RestSupport => {
          if (this.engineApi === "auto" && isRestApiAbsent(e)) {
            this.restSupport = {state: "unsupported"};
            this.logger.debug(
              "Execution client does not support engine API over REST, using JSON-RPC",
              e instanceof EngineRestError
                ? {status: e.status, type: e.type ?? "unknown"}
                : {contentType: (e as EngineRestContentTypeError).contentType ?? "none"}
            );
          } else {
            const transient = isRetryableEngineRestError(e);
            this.restSupport = {state: "pending", error: this.engineApi === "auto" && transient ? undefined : e};
            this.logger.debug(
              "Unable to probe engine API capabilities",
              {
                engineApi: this.engineApi,
                fallback: this.restSupport.error ? "none" : "json-rpc",
                retryAfterMs: REST_PROBE_RETRY_MS,
              },
              e
            );
          }
          return this.restSupport;
        }
      )
      .finally(() => {
        this.restProbe = null;
        this.lastRestProbeMs = Date.now();
      });

    return this.restProbe;
  }

  private async getClientVersion(clientVersion: ClientVersion): Promise<ClientVersion[]> {
    const clientVersions = await this.withTransport(undefined, undefined, (transport) =>
      transport.getClientVersion(clientVersion)
    );

    if (clientVersions.length === 0) {
      throw Error("Received empty client versions array");
    }

    this.clientVersion = clientVersions[0];
    this.logger.debug("Execution client version updated", this.clientVersion);

    return clientVersions;
  }

  private updateEngineState(newState: ExecutionEngineState, error?: Error): void {
    const oldState = this.state;

    if (oldState === newState) return;

    switch (newState) {
      case ExecutionEngineState.ONLINE:
        this.logger.info("Execution client became online", {oldState, newState});
        if (oldState === ExecutionEngineState.AUTH_FAILED) {
          this.restSupport = {state: "pending"};
          this.lastRestProbeMs = Number.NEGATIVE_INFINITY;
        }
        this.getClientVersion(getLodestarClientVersion(this.opts)).catch((e) => {
          this.logger.debug("Unable to get execution client version", {}, e);
          this.clientVersion = null;
        });
        break;
      case ExecutionEngineState.OFFLINE:
        // Reprobe before choosing a transport for the next call after a disconnect.
        this.restSupport = {state: "pending"};
        this.lastRestProbeMs = Number.NEGATIVE_INFINITY;
        this.logger.error("Execution client went offline", {oldState, newState}, error);
        break;
      case ExecutionEngineState.SYNCED:
        this.logger.info("Execution client is synced", {oldState, newState});
        break;
      case ExecutionEngineState.SYNCING:
        this.logger.warn(
          error ? "Execution client request failed" : "Execution client is syncing",
          {oldState, newState},
          error
        );
        break;
      case ExecutionEngineState.AUTH_FAILED:
        this.logger.error("Execution client authentication failed", {oldState, newState}, error);
        break;
    }

    this.state = newState;
  }
}

/** The execution client answered, as opposed to being unreachable */
function isEngineResponseError(e: Error): boolean {
  return (
    e instanceof HttpRpcError ||
    e instanceof ErrorJsonRpcResponse ||
    e instanceof EngineRestError ||
    e instanceof EngineRestResponseError
  );
}

/**
 * Legacy JSON-RPC servers and proxies answer the capabilities probe in different ways, a 404,
 * another client error such as 405, or any GET with a non-JSON body. None of them serve the REST API.
 */
function isRestApiAbsent(e: Error): boolean {
  if (e instanceof EngineRestContentTypeError) return true;
  return e instanceof EngineRestError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403;
}

function isUnsupportedForkError(e: unknown): e is EngineRestError {
  return e instanceof EngineRestError && e.status === 400 && e.type === "/engine-api/errors/unsupported-fork";
}
