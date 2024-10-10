import {ExecutionPayload, ExecutionRequests, Root, RootHex, Wei} from "@lodestar/types";
import {SLOTS_PER_EPOCH, ForkName, ForkSeq} from "@lodestar/params";
import {Logger} from "@lodestar/logger";
import {
  ErrorJsonRpcResponse,
  HttpRpcError,
  IJsonRpcHttpClient,
  JsonRpcHttpClientEvent,
  ReqOpts,
} from "../../eth1/provider/jsonRpcHttpClient.js";
import {Metrics} from "../../metrics/index.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {EPOCHS_PER_BATCH} from "../../sync/constants.js";
import {numToQuantity} from "../../eth1/provider/utils.js";
import {getLodestarClientVersion} from "../../util/metadata.js";
import {
  ExecutionPayloadStatus,
  ExecutePayloadResponse,
  IExecutionEngine,
  PayloadId,
  PayloadAttributes,
  BlobsBundle,
  VersionedHashes,
  ExecutionEngineState,
  ClientVersion,
  ClientCode,
} from "./interface.js";
import {PayloadIdCache} from "./payloadIdCache.js";
import {
  EngineApiRpcParamTypes,
  EngineApiRpcReturnTypes,
  parseExecutionPayload,
  serializeExecutionPayload,
  serializeVersionedHashes,
  serializePayloadAttributes,
  serializeBeaconBlockRoot,
  ExecutionPayloadBody,
  assertReqSizeLimit,
  deserializeExecutionPayloadBody,
  serializeExecutionRequests,
} from "./types.js";
import {getExecutionEngineState} from "./utils.js";

export type ExecutionEngineModules = {
  signal: AbortSignal;
  metrics?: Metrics | null;
  logger: Logger;
};

export type ExecutionEngineHttpOpts = {
  urls: string[];
  retries: number;
  retryDelay: number;
  timeout?: number;
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
};

/**
 * Size for the serializing queue for fcUs and new payloads, the max length could be equal to
 * EPOCHS_PER_BATCH * 2 in case new payloads are also not awaited serially
 */
const QUEUE_MAX_LENGTH = EPOCHS_PER_BATCH * SLOTS_PER_EPOCH * 2;

// Define static options once to prevent extra allocations
const notifyNewPayloadOpts: ReqOpts = {routeId: "notifyNewPayload"};
const forkchoiceUpdatedV1Opts: ReqOpts = {routeId: "forkchoiceUpdated"};
const getPayloadOpts: ReqOpts = {routeId: "getPayload"};

/**
 * based on Ethereum JSON-RPC API and inherits the following properties of this standard:
 * - Supported communication protocols (HTTP and WebSocket)
 * - Message format and encoding notation
 * - Error codes improvement proposal
 *
 * Client software MUST expose Engine API at a port independent from JSON-RPC API. The default port for the Engine API is 8550 for HTTP and 8551 for WebSocket.
 * https://github.com/ethereum/execution-apis/blob/v1.0.0-alpha.1/src/engine/interop/specification.md
 */
export class ExecutionEngineHttp implements IExecutionEngine {
  private logger: Logger;

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
  private readonly rpcFetchQueue: JobItemQueue<[EngineRequest], EngineResponse>;

  private jobQueueProcessor = async ({method, params, methodOpts}: EngineRequest): Promise<EngineResponse> => {
    return this.rpc.fetchWithRetries<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>(
      {method, params},
      methodOpts
    );
  };

  constructor(
    private readonly rpc: IJsonRpcHttpClient,
    {metrics, signal, logger}: ExecutionEngineModules,
    private readonly opts?: ExecutionEngineHttpOpts
  ) {
    this.rpcFetchQueue = new JobItemQueue<[EngineRequest], EngineResponse>(
      this.jobQueueProcessor,
      {maxLength: QUEUE_MAX_LENGTH, maxConcurrency: 1, noYieldIfOneItem: true, signal},
      metrics?.engineHttpProcessorQueue
    );
    this.logger = logger;

    this.rpc.emitter.on(JsonRpcHttpClientEvent.ERROR, ({error}) => {
      this.updateEngineState(getExecutionEngineState({payloadError: error, oldState: this.state}));
    });

    this.rpc.emitter.on(JsonRpcHttpClientEvent.RESPONSE, () => {
      if (this.clientVersion === undefined) {
        this.clientVersion = null;
        // This statement should only be called first time receiving response after startup
        this.getClientVersion(getLodestarClientVersion(this.opts)).catch((e) => {
          this.logger.debug("Unable to get execution client version", {}, e);
        });
      }
      this.updateEngineState(getExecutionEngineState({targetState: ExecutionEngineState.ONLINE, oldState: this.state}));
    });
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
   *   2. {status: INVALID_TERMINAL_BLOCK, latestValidHash: null, validationError:
   *      errorMessage | null} if terminal block conditions are not satisfied
   *
   *   3. {status: SYNCING, latestValidHash: null, validationError: null} if the payload
   *      extends the canonical chain and requisite data for its validation is missing
   *      with the payload status obtained from the Payload validation process if the payload
   *      has been fully validated while processing the call
   *
   *   4. {status: ACCEPTED, latestValidHash: null, validationError: null} if the
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
    const method =
      ForkSeq[fork] >= ForkSeq.electra
        ? "engine_newPayloadV4"
        : ForkSeq[fork] >= ForkSeq.deneb
          ? "engine_newPayloadV3"
          : ForkSeq[fork] >= ForkSeq.capella
            ? "engine_newPayloadV2"
            : "engine_newPayloadV1";

    const serializedExecutionPayload = serializeExecutionPayload(fork, executionPayload);

    let engineRequest: EngineRequest;
    if (ForkSeq[fork] >= ForkSeq.deneb) {
      if (versionedHashes === undefined) {
        throw Error(`versionedHashes required in notifyNewPayload for fork=${fork}`);
      }
      if (parentBlockRoot === undefined) {
        throw Error(`parentBlockRoot required in notifyNewPayload for fork=${fork}`);
      }

      const serializedVersionedHashes = serializeVersionedHashes(versionedHashes);
      const parentBeaconBlockRoot = serializeBeaconBlockRoot(parentBlockRoot);

      if (ForkSeq[fork] >= ForkSeq.electra) {
        if (executionRequests === undefined) {
          throw Error(`executionRequests required in notifyNewPayload for fork=${fork}`);
        }
        const serializedExecutionRequests = serializeExecutionRequests(executionRequests);
        engineRequest = {
          method: "engine_newPayloadV4",
          params: [
            serializedExecutionPayload,
            serializedVersionedHashes,
            parentBeaconBlockRoot,
            serializedExecutionRequests,
          ],
          methodOpts: notifyNewPayloadOpts,
        };
      } else {
        engineRequest = {
          method: "engine_newPayloadV3",
          params: [serializedExecutionPayload, serializedVersionedHashes, parentBeaconBlockRoot],
          methodOpts: notifyNewPayloadOpts,
        };
      }
    } else {
      const method = ForkSeq[fork] >= ForkSeq.capella ? "engine_newPayloadV2" : "engine_newPayloadV1";
      engineRequest = {
        method,
        params: [serializedExecutionPayload],
        methodOpts: notifyNewPayloadOpts,
      };
    }

    const {status, latestValidHash, validationError} = await (
      this.rpcFetchQueue.push(engineRequest) as Promise<EngineApiRpcReturnTypes[typeof method]>
    ).catch((e: Error) => {
      if (e instanceof HttpRpcError || e instanceof ErrorJsonRpcResponse) {
        return {status: ExecutionPayloadStatus.ELERROR, latestValidHash: null, validationError: e.message};
      } else {
        return {status: ExecutionPayloadStatus.UNAVAILABLE, latestValidHash: null, validationError: e.message};
      }
    });

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
   *   3. {payloadStatus: {status: INVALID_TERMINAL_BLOCK, latestValidHash: null,
   *      validationError: errorMessage | null}, payloadId: null}
   *      either obtained from the Payload validation process or as a result of validating a
   *      PoW block referenced by forkchoiceState.headBlockHash
   *
   *   4. {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash,
   *      validationError: null}, payloadId: null}
   *      if the payload is deemed VALID and a build process hasn't been started
   *
   *   5. {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash,
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
    // Once on capella, should this need to be permanently switched to v2 when payload attrs
    // not provided
    const method =
      ForkSeq[fork] >= ForkSeq.deneb
        ? "engine_forkchoiceUpdatedV3"
        : ForkSeq[fork] >= ForkSeq.capella
          ? "engine_forkchoiceUpdatedV2"
          : "engine_forkchoiceUpdatedV1";
    const payloadAttributesRpc = payloadAttributes ? serializePayloadAttributes(payloadAttributes) : undefined;
    // If we are just fcUing and not asking execution for payload, retry is not required
    // and we can move on, as the next fcU will be issued soon on the new slot
    const fcUReqOpts =
      payloadAttributes !== undefined ? forkchoiceUpdatedV1Opts : {...forkchoiceUpdatedV1Opts, retries: 0};

    const request = this.rpcFetchQueue.push({
      method,
      params: [{headBlockHash, safeBlockHash, finalizedBlockHash}, payloadAttributesRpc],
      methodOpts: fcUReqOpts,
    }) as Promise<EngineApiRpcReturnTypes[typeof method]>;

    const {
      payloadStatus: {status, latestValidHash: _latestValidHash, validationError},
      payloadId,
    } = await request;

    this.updateEngineState(getExecutionEngineState({payloadStatus: status, oldState: this.state}));

    switch (status) {
      case ExecutionPayloadStatus.VALID:
        // if payloadAttributes are provided, a valid payloadId is expected
        if (payloadAttributesRpc) {
          if (!payloadId || payloadId === "0x") {
            throw Error(`Received invalid payloadId=${payloadId}`);
          }

          this.payloadIdCache.add({headBlockHash, finalizedBlockHash, ...payloadAttributesRpc}, payloadId);
          void this.prunePayloadIdCache();
        }
        return payloadId !== "0x" ? payloadId : null;

      case ExecutionPayloadStatus.SYNCING:
        // Throw error on syncing if requested to produce a block, else silently ignore
        if (payloadAttributes) {
          throw Error("Execution Layer Syncing");
        } else {
          return null;
        }

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
    const method =
      ForkSeq[fork] >= ForkSeq.electra
        ? "engine_getPayloadV4"
        : ForkSeq[fork] >= ForkSeq.deneb
          ? "engine_getPayloadV3"
          : ForkSeq[fork] >= ForkSeq.capella
            ? "engine_getPayloadV2"
            : "engine_getPayloadV1";
    const payloadResponse = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >(
      {
        method,
        params: [payloadId],
      },
      getPayloadOpts
    );
    return parseExecutionPayload(fork, payloadResponse);
  }

  async prunePayloadIdCache(): Promise<void> {
    this.payloadIdCache.prune();
  }

  async getPayloadBodiesByHash(_fork: ForkName, blockHashes: RootHex[]): Promise<(ExecutionPayloadBody | null)[]> {
    const method = "engine_getPayloadBodiesByHashV1";
    assertReqSizeLimit(blockHashes.length, 32);
    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [blockHashes]});
    return response.map(deserializeExecutionPayloadBody);
  }

  async getPayloadBodiesByRange(
    _fork: ForkName,
    startBlockNumber: number,
    blockCount: number
  ): Promise<(ExecutionPayloadBody | null)[]> {
    const method = "engine_getPayloadBodiesByRangeV1";
    assertReqSizeLimit(blockCount, 32);
    const start = numToQuantity(startBlockNumber);
    const count = numToQuantity(blockCount);
    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [start, count]});
    return response.map(deserializeExecutionPayloadBody);
  }

  private async getClientVersion(clientVersion: ClientVersion): Promise<ClientVersion[]> {
    const method = "engine_getClientVersionV1";

    const response = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({method, params: [clientVersion]});

    const clientVersions = response.map((cv) => {
      const code = cv.code in ClientCode ? ClientCode[cv.code as keyof typeof ClientCode] : ClientCode.XX;
      return {code, name: cv.name, version: cv.version, commit: cv.commit};
    });

    if (clientVersions.length === 0) {
      throw Error("Received empty client versions array");
    }

    this.clientVersion = clientVersions[0];
    this.logger.debug("Execution client version updated", this.clientVersion);

    return clientVersions;
  }

  private updateEngineState(newState: ExecutionEngineState): void {
    const oldState = this.state;

    if (oldState === newState) return;

    switch (newState) {
      case ExecutionEngineState.ONLINE:
        this.logger.info("Execution client became online", {oldState, newState});
        this.getClientVersion(getLodestarClientVersion(this.opts)).catch((e) => {
          this.logger.debug("Unable to get execution client version", {}, e);
          this.clientVersion = null;
        });
        break;
      case ExecutionEngineState.OFFLINE:
        this.logger.error("Execution client went offline", {oldState, newState});
        break;
      case ExecutionEngineState.SYNCED:
        this.logger.info("Execution client is synced", {oldState, newState});
        break;
      case ExecutionEngineState.SYNCING:
        this.logger.warn("Execution client is syncing", {oldState, newState});
        break;
      case ExecutionEngineState.AUTH_FAILED:
        this.logger.error("Execution client authentication failed", {oldState, newState});
        break;
    }

    this.state = newState;
  }
}

type EngineRequestKey = keyof EngineApiRpcParamTypes;
type EngineRequestByKey = {
  [K in EngineRequestKey]: {method: K; params: EngineApiRpcParamTypes[K]; methodOpts: ReqOpts};
};
type EngineRequest = EngineRequestByKey[EngineRequestKey];
type EngineResponseByKey = {[K in EngineRequestKey]: EngineApiRpcReturnTypes[K]};
type EngineResponse = EngineResponseByKey[EngineRequestKey];
