import {RootHex, allForks, capella, eip4844} from "@lodestar/types";
import {
  BYTES_PER_LOGS_BLOOM,
  SLOTS_PER_EPOCH,
  FIELD_ELEMENTS_PER_BLOB,
  BYTES_PER_FIELD_ELEMENT,
  ForkName,
  ForkSeq,
} from "@lodestar/params";
import {fromHex} from "@lodestar/utils";

import {ErrorJsonRpcResponse, HttpRpcError, JsonRpcHttpClient} from "../../eth1/provider/jsonRpcHttpClient.js";
import {
  bytesToData,
  numToQuantity,
  dataToBytes,
  quantityToNum,
  DATA,
  QUANTITY,
  quantityToBigint,
  dataToRootHex,
} from "../../eth1/provider/utils.js";
import {IJsonRpcHttpClient, ReqOpts} from "../../eth1/provider/jsonRpcHttpClient.js";
import {IMetrics} from "../../metrics/index.js";
import {JobItemQueue} from "../../util/queue/index.js";
import {EPOCHS_PER_BATCH} from "../../sync/constants.js";
import {
  ExecutePayloadStatus,
  ExecutePayloadResponse,
  ForkChoiceUpdateStatus,
  IExecutionEngine,
  PayloadId,
  PayloadAttributes,
  ApiPayloadAttributes,
  WithdrawalV1,
  TransitionConfigurationV1,
  BlobsBundle,
} from "./interface.js";
import {PayloadIdCache} from "./payloadIdCache.js";

const GWEI_TO_WEI = BigInt(1000000000);

export type ExecutionEngineModules = {
  signal: AbortSignal;
  metrics?: IMetrics | null;
};

export type ExecutionEngineHttpOpts = {
  urls: string[];
  retryAttempts: number;
  retryDelay: number;
  timeout?: number;
  /**
   * 256 bit jwt secret in hex format without the leading 0x. If provided, the execution engine
   * rpc requests will be bundled by an authorization header having a fresh jwt token on each
   * request, as the EL auth specs mandate the fresh of the token (iat) to be checked within
   * +-5 seconds interval.
   */
  jwtSecretHex?: string;
};

export const defaultExecutionEngineHttpOpts: ExecutionEngineHttpOpts = {
  /**
   * By default ELs host engine api on an auth protected 8551 port, would need a jwt secret to be
   * specified to bundle jwt tokens if that is the case. In case one has access to an open
   * port/url, one can override this and skip providing a jwt secret.
   */
  urls: ["http://localhost:8551"],
  retryAttempts: 3,
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
const exchageTransitionConfigOpts: ReqOpts = {routeId: "exchangeTransitionConfiguration"};

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
  readonly payloadIdCache = new PayloadIdCache();
  private readonly rpc: IJsonRpcHttpClient;
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

  constructor(opts: ExecutionEngineHttpOpts, {metrics, signal}: ExecutionEngineModules) {
    this.rpc = new JsonRpcHttpClient(opts.urls, {
      ...opts,
      signal,
      metrics: metrics?.executionEnginerHttpClient,
      jwtSecret: opts.jwtSecretHex ? fromHex(opts.jwtSecretHex) : undefined,
    });
    this.rpcFetchQueue = new JobItemQueue<[EngineRequest], EngineResponse>(
      this.jobQueueProcessor,
      {maxLength: QUEUE_MAX_LENGTH, maxConcurrency: 1, signal},
      metrics?.engineHttpProcessorQueue
    );
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
  async notifyNewPayload(fork: ForkName, executionPayload: allForks.ExecutionPayload): Promise<ExecutePayloadResponse> {
    const method = ForkSeq[fork] >= ForkSeq.capella ? "engine_newPayloadV2" : "engine_newPayloadV1";
    const serializedExecutionPayload = serializeExecutionPayload(fork, executionPayload);
    const {status, latestValidHash, validationError} = await (this.rpcFetchQueue.push({
      method,
      params: [serializedExecutionPayload],
      methodOpts: notifyNewPayloadOpts,
    }) as Promise<EngineApiRpcReturnTypes[typeof method]>)
      // If there are errors by EL like connection refused, internal error, they need to be
      // treated separate from being INVALID. For now, just pass the error upstream.
      .catch((e: Error): EngineApiRpcReturnTypes[typeof method] => {
        if (e instanceof HttpRpcError || e instanceof ErrorJsonRpcResponse) {
          return {status: ExecutePayloadStatus.ELERROR, latestValidHash: null, validationError: e.message};
        } else {
          return {status: ExecutePayloadStatus.UNAVAILABLE, latestValidHash: null, validationError: e.message};
        }
      });

    switch (status) {
      case ExecutePayloadStatus.VALID:
        return {status, latestValidHash: latestValidHash ?? "0x0", validationError: null};

      case ExecutePayloadStatus.INVALID:
        // As per latest specs if latestValidHash can be null and it would mean only
        // invalidate this block
        return {status, latestValidHash, validationError};

      case ExecutePayloadStatus.SYNCING:
      case ExecutePayloadStatus.ACCEPTED:
        return {status, latestValidHash: null, validationError: null};

      case ExecutePayloadStatus.INVALID_BLOCK_HASH:
        return {status, latestValidHash: null, validationError: validationError ?? "Malformed block"};

      case ExecutePayloadStatus.UNAVAILABLE:
      case ExecutePayloadStatus.ELERROR:
        return {
          status,
          latestValidHash: null,
          validationError: validationError ?? "Unknown ELERROR",
        };

      default:
        return {
          status: ExecutePayloadStatus.ELERROR,
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
    const method = ForkSeq[fork] >= ForkSeq.capella ? "engine_forkchoiceUpdatedV2" : "engine_forkchoiceUpdatedV1";
    const apiPayloadAttributes: ApiPayloadAttributes | undefined = payloadAttributes
      ? {
          timestamp: numToQuantity(payloadAttributes.timestamp),
          prevRandao: bytesToData(payloadAttributes.prevRandao),
          suggestedFeeRecipient: payloadAttributes.suggestedFeeRecipient,
          withdrawals: payloadAttributes.withdrawals?.map(serializeWithdrawal),
        }
      : undefined;
    // If we are just fcUing and not asking execution for payload, retry is not required
    // and we can move on, as the next fcU will be issued soon on the new slot
    const fcUReqOpts =
      payloadAttributes !== undefined ? forkchoiceUpdatedV1Opts : {...forkchoiceUpdatedV1Opts, retryAttempts: 1};

    const request = this.rpcFetchQueue.push({
      method,
      params: [{headBlockHash, safeBlockHash, finalizedBlockHash}, apiPayloadAttributes],
      methodOpts: fcUReqOpts,
    }) as Promise<EngineApiRpcReturnTypes[typeof method]>;

    const response = await request;
    const {
      payloadStatus: {status, latestValidHash: _latestValidHash, validationError},
      payloadId,
    } = response;

    switch (status) {
      case ExecutePayloadStatus.VALID:
        // if payloadAttributes are provided, a valid payloadId is expected
        if (apiPayloadAttributes) {
          if (!payloadId || payloadId === "0x") {
            throw Error(`Received invalid payloadId=${payloadId}`);
          }

          this.payloadIdCache.add({headBlockHash, finalizedBlockHash, ...apiPayloadAttributes}, payloadId);
          void this.prunePayloadIdCache();
        }
        return payloadId !== "0x" ? payloadId : null;

      case ExecutePayloadStatus.SYNCING:
        // Throw error on syncing if requested to produce a block, else silently ignore
        if (payloadAttributes) {
          throw Error("Execution Layer Syncing");
        } else {
          return null;
        }

      case ExecutePayloadStatus.INVALID:
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
  async getPayload(fork: ForkName, payloadId: PayloadId): Promise<allForks.ExecutionPayload> {
    const method = ForkSeq[fork] >= ForkSeq.capella ? "engine_getPayloadV2" : "engine_getPayloadV1";
    const executionPayloadRpc = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >(
      {
        method,
        params: [payloadId],
      },
      getPayloadOpts
    );
    return parseExecutionPayload(fork, executionPayloadRpc);
  }

  async getBlobsBundle(payloadId: PayloadId): Promise<BlobsBundle> {
    const method = "engine_getBlobsBundleV1";
    const blobsBundle = await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >(
      {
        method,
        params: [payloadId],
      },
      getPayloadOpts
    );

    return parseBlobsBundle(blobsBundle);
  }

  /**
   * `engine_exchangeTransitionConfigurationV1`
   *
   * An api method for EL<>CL transition config matching and heartbeat
   */

  async exchangeTransitionConfigurationV1(
    transitionConfiguration: TransitionConfigurationV1
  ): Promise<TransitionConfigurationV1> {
    const method = "engine_exchangeTransitionConfigurationV1";
    return await this.rpc.fetchWithRetries<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >(
      {
        method,
        params: [transitionConfiguration],
      },
      exchageTransitionConfigOpts
    );
  }

  async prunePayloadIdCache(): Promise<void> {
    this.payloadIdCache.prune();
  }
}

/* eslint-disable @typescript-eslint/naming-convention */

type EngineApiRpcParamTypes = {
  /**
   * 1. Object - Instance of ExecutionPayload
   */
  engine_newPayloadV1: [ExecutionPayloadRpc];
  engine_newPayloadV2: [ExecutionPayloadRpc];
  /**
   * 1. Object - Payload validity status with respect to the consensus rules:
   *   - blockHash: DATA, 32 Bytes - block hash value of the payload
   *   - status: String: VALID|INVALID - result of the payload validation with respect to the proof-of-stake consensus rules
   */
  engine_forkchoiceUpdatedV1: [
    param1: {headBlockHash: DATA; safeBlockHash: DATA; finalizedBlockHash: DATA},
    payloadAttributes?: ApiPayloadAttributes
  ];
  engine_forkchoiceUpdatedV2: [
    param1: {headBlockHash: DATA; safeBlockHash: DATA; finalizedBlockHash: DATA},
    payloadAttributes?: ApiPayloadAttributes
  ];
  /**
   * 1. payloadId: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getPayloadV1: [QUANTITY];
  engine_getPayloadV2: [QUANTITY];
  /**
   * 1. Object - Instance of TransitionConfigurationV1
   */
  engine_exchangeTransitionConfigurationV1: [TransitionConfigurationV1];
  /**
   * 1. payloadId: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getBlobsBundleV1: [QUANTITY];
};

type EngineApiRpcReturnTypes = {
  /**
   * Object - Response object:
   * - status: String - the result of the payload execution:
   */
  engine_newPayloadV1: {
    status: ExecutePayloadStatus;
    latestValidHash: DATA | null;
    validationError: string | null;
  };
  engine_newPayloadV2: {
    status: ExecutePayloadStatus;
    latestValidHash: DATA | null;
    validationError: string | null;
  };
  engine_forkchoiceUpdatedV1: {
    payloadStatus: {status: ForkChoiceUpdateStatus; latestValidHash: DATA | null; validationError: string | null};
    payloadId: QUANTITY | null;
  };
  engine_forkchoiceUpdatedV2: {
    payloadStatus: {status: ForkChoiceUpdateStatus; latestValidHash: DATA | null; validationError: string | null};
    payloadId: QUANTITY | null;
  };
  /**
   * payloadId | Error: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getPayloadV1: ExecutionPayloadRpc;
  engine_getPayloadV2: ExecutionPayloadRpc;
  /**
   * Object - Instance of TransitionConfigurationV1
   */
  engine_exchangeTransitionConfigurationV1: TransitionConfigurationV1;

  engine_getBlobsBundleV1: BlobsBundleRpc;
};

type ExecutionPayloadRpc = {
  parentHash: DATA; // 32 bytes
  feeRecipient: DATA; // 20 bytes
  stateRoot: DATA; // 32 bytes
  receiptsRoot: DATA; // 32 bytes
  logsBloom: DATA; // 256 bytes
  prevRandao: DATA; // 32 bytes
  blockNumber: QUANTITY;
  gasLimit: QUANTITY;
  gasUsed: QUANTITY;
  timestamp: QUANTITY;
  extraData: DATA; // 0 to 32 bytes
  baseFeePerGas: QUANTITY;
  blockHash: DATA; // 32 bytes
  transactions: DATA[];
  withdrawals?: WithdrawalV1[]; // Capella hardfork
  excessDataGas?: QUANTITY; // EIP-4844
};

interface BlobsBundleRpc {
  blockHash: DATA; // 32 Bytes
  kzgs: DATA[]; // each 48 bytes
  blobs: DATA[]; // each 4096 * 32 = 131072 bytes
}

export function serializeExecutionPayload(fork: ForkName, data: allForks.ExecutionPayload): ExecutionPayloadRpc {
  const payload: ExecutionPayloadRpc = {
    parentHash: bytesToData(data.parentHash),
    feeRecipient: bytesToData(data.feeRecipient),
    stateRoot: bytesToData(data.stateRoot),
    receiptsRoot: bytesToData(data.receiptsRoot),
    logsBloom: bytesToData(data.logsBloom),
    prevRandao: bytesToData(data.prevRandao),
    blockNumber: numToQuantity(data.blockNumber),
    gasLimit: numToQuantity(data.gasLimit),
    gasUsed: numToQuantity(data.gasUsed),
    timestamp: numToQuantity(data.timestamp),
    extraData: bytesToData(data.extraData),
    baseFeePerGas: numToQuantity(data.baseFeePerGas),
    blockHash: bytesToData(data.blockHash),
    transactions: data.transactions.map((tran) => bytesToData(tran)),
  };

  // Capella adds withdrawals to the ExecutionPayload
  if (ForkSeq[fork] >= ForkSeq.capella) {
    const {withdrawals} = data as capella.ExecutionPayload;
    payload.withdrawals = withdrawals.map(serializeWithdrawal);
  }

  // EIP-4844 adds excessDataGas to the ExecutionPayload
  if ((data as eip4844.ExecutionPayload).excessDataGas !== undefined) {
    payload.excessDataGas = numToQuantity((data as eip4844.ExecutionPayload).excessDataGas);
  }

  return payload;
}

export function parseExecutionPayload(fork: ForkName, data: ExecutionPayloadRpc): allForks.ExecutionPayload {
  const payload = {
    parentHash: dataToBytes(data.parentHash, 32),
    feeRecipient: dataToBytes(data.feeRecipient, 20),
    stateRoot: dataToBytes(data.stateRoot, 32),
    receiptsRoot: dataToBytes(data.receiptsRoot, 32),
    logsBloom: dataToBytes(data.logsBloom, BYTES_PER_LOGS_BLOOM),
    prevRandao: dataToBytes(data.prevRandao, 32),
    blockNumber: quantityToNum(data.blockNumber),
    gasLimit: quantityToNum(data.gasLimit),
    gasUsed: quantityToNum(data.gasUsed),
    timestamp: quantityToNum(data.timestamp),
    extraData: dataToBytes(data.extraData, null),
    baseFeePerGas: quantityToBigint(data.baseFeePerGas),
    blockHash: dataToBytes(data.blockHash, 32),
    transactions: data.transactions.map((tran) => dataToBytes(tran, null)),
  };

  if (ForkSeq[fork] >= ForkSeq.capella) {
    const {withdrawals} = data;
    // Geth can also reply with null
    if (withdrawals == null) {
      throw Error(
        `withdrawals missing for ${fork} >= capella executionPayload number=${payload.blockNumber} hash=${data.blockHash}`
      );
    }
    (payload as capella.ExecutionPayload).withdrawals = withdrawals.map((w) => deserializeWithdrawal(w));
  }

  // EIP-4844 adds excessDataGas to the ExecutionPayload
  if (ForkSeq[fork] >= ForkSeq.eip4844) {
    if (data.excessDataGas == null) {
      throw Error(
        `excessDataGas missing for ${fork} >= eip4844 executionPayload number=${payload.blockNumber} hash=${data.blockHash}`
      );
    }
    (payload as eip4844.ExecutionPayload).excessDataGas = quantityToBigint(data.excessDataGas);
  }

  return payload;
}

export function parseBlobsBundle(data: BlobsBundleRpc): BlobsBundle {
  return {
    // NOTE: Keep as hex, since it's only used for equality downstream
    blockHash: dataToRootHex(data.blockHash),
    // As of Nov 17th 2022 according to Dan's tests Geth returns null if no blobs in block
    kzgs: (data.kzgs ?? []).map((kzg) => dataToBytes(kzg, 48)),
    blobs: (data.blobs ?? []).map((blob) => dataToBytes(blob, BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB)),
  };
}

function serializeWithdrawal(withdrawal: capella.Withdrawal): WithdrawalV1 {
  return {
    index: numToQuantity(withdrawal.index),
    validatorIndex: numToQuantity(withdrawal.validatorIndex),
    address: bytesToData(withdrawal.address),
    // Note: the amount value is represented on the beacon chain as a little-endian value in
    // units of Gwei, whereas the amount in this structure MUST be converted to a big-endian value
    // in units of Wei
    //
    // see: https://github.com/ethereum/execution-apis/blob/main/src/engine/specification.md
    amount: numToQuantity(withdrawal.amount * GWEI_TO_WEI),
  };
}

function deserializeWithdrawal(serialized: WithdrawalV1): capella.Withdrawal {
  return {
    index: quantityToNum(serialized.index),
    validatorIndex: quantityToNum(serialized.validatorIndex),
    address: dataToBytes(serialized.address, 20),
    // see: https://github.com/ethereum/execution-apis/blob/main/src/engine/specification.md
    amount: quantityToBigint(serialized.amount) / GWEI_TO_WEI,
  } as capella.Withdrawal;
}

type EngineRequestKey = keyof EngineApiRpcParamTypes;
type EngineRequestByKey = {
  [K in EngineRequestKey]: {method: K; params: EngineApiRpcParamTypes[K]; methodOpts: ReqOpts};
};
type EngineRequest = EngineRequestByKey[EngineRequestKey];
type EngineResponseByKey = {[K in EngineRequestKey]: EngineApiRpcReturnTypes[K]};
type EngineResponse = EngineResponseByKey[EngineRequestKey];
