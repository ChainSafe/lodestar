import {AbortSignal} from "@chainsafe/abort-controller";
import {bellatrix, RootHex, Root} from "@chainsafe/lodestar-types";
import {BYTES_PER_LOGS_BLOOM} from "@chainsafe/lodestar-params";
import {fromHex} from "@chainsafe/lodestar-utils";

import {ErrorJsonRpcResponse, HttpRpcError, JsonRpcHttpClient} from "../eth1/provider/jsonRpcHttpClient";
import {
  bytesToData,
  numToQuantity,
  dataToBytes,
  quantityToNum,
  DATA,
  QUANTITY,
  quantityToBigint,
} from "../eth1/provider/utils";
import {IJsonRpcHttpClient} from "../eth1/provider/jsonRpcHttpClient";
import {
  ExecutePayloadStatus,
  ExecutePayloadResponse,
  ForkChoiceUpdateStatus,
  IExecutionEngine,
  PayloadId,
  PayloadAttributes,
  ApiPayloadAttributes,
} from "./interface";

export type ExecutionEngineHttpOpts = {
  urls: string[];
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
  urls: ["http://localhost:8550"],
  timeout: 12000,
};

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
  private readonly rpc: IJsonRpcHttpClient;

  constructor(opts: ExecutionEngineHttpOpts, signal: AbortSignal, rpc?: IJsonRpcHttpClient) {
    this.rpc =
      rpc ??
      new JsonRpcHttpClient(opts.urls, {
        signal,
        timeout: opts.timeout,
        jwtSecret: opts.jwtSecretHex ? fromHex(opts.jwtSecretHex) : undefined,
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
  async notifyNewPayload(executionPayload: bellatrix.ExecutionPayload): Promise<ExecutePayloadResponse> {
    const method = "engine_newPayloadV1";
    const serializedExecutionPayload = serializeExecutionPayload(executionPayload);
    const {status, latestValidHash, validationError} = await this.rpc
      .fetch<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>({
        method,
        params: [serializedExecutionPayload],
      })
      // If there are errors by EL like connection refused, internal error, they need to be
      // treated seperate from being INVALID. For now, just pass the error upstream.
      .catch((e: Error): EngineApiRpcReturnTypes[typeof method] => {
        if (e instanceof HttpRpcError || e instanceof ErrorJsonRpcResponse) {
          return {status: ExecutePayloadStatus.ELERROR, latestValidHash: null, validationError: e.message};
        } else {
          return {status: ExecutePayloadStatus.UNAVAILABLE, latestValidHash: null, validationError: e.message};
        }
      });

    switch (status) {
      case ExecutePayloadStatus.VALID:
        if (latestValidHash == null) {
          return {
            status: ExecutePayloadStatus.ELERROR,
            latestValidHash: null,
            validationError: `Invalid null latestValidHash for status=${status}`,
          };
        } else {
          return {status, latestValidHash, validationError: null};
        }

      case ExecutePayloadStatus.INVALID:
        if (latestValidHash == null) {
          return {
            status: ExecutePayloadStatus.ELERROR,
            latestValidHash: null,
            validationError: `Invalid null latestValidHash for status=${status}`,
          };
        } else {
          return {status, latestValidHash, validationError};
        }

      case ExecutePayloadStatus.SYNCING:
      case ExecutePayloadStatus.ACCEPTED:
        return {status, latestValidHash: null, validationError: null};

      case ExecutePayloadStatus.INVALID_BLOCK_HASH:
      case ExecutePayloadStatus.INVALID_TERMINAL_BLOCK:
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
    headBlockHash: Root | RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<PayloadId | null> {
    const method = "engine_forkchoiceUpdatedV1";
    const headBlockHashData = typeof headBlockHash === "string" ? headBlockHash : bytesToData(headBlockHash);
    const apiPayloadAttributes: ApiPayloadAttributes | undefined = payloadAttributes
      ? {
          timestamp: numToQuantity(payloadAttributes.timestamp),
          prevRandao: bytesToData(payloadAttributes.prevRandao),
          suggestedFeeRecipient: bytesToData(payloadAttributes.suggestedFeeRecipient),
        }
      : undefined;

    // TODO: propogate latestValidHash to the forkchoice, for now ignore it as we
    // currently do not propogate the validation status up the forkchoice
    const {
      payloadStatus: {status, latestValidHash: _latestValidHash, validationError},
      payloadId,
    } = await this.rpc.fetch<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>({
      method,
      params: [
        {headBlockHash: headBlockHashData, safeBlockHash: headBlockHashData, finalizedBlockHash},
        apiPayloadAttributes,
      ],
    });

    switch (status) {
      case ExecutePayloadStatus.VALID:
        // if payloadAttributes are provided, a valid payloadId is expected
        if (payloadAttributes && (!payloadId || payloadId === "0x")) {
          throw Error(`Received invalid payloadId=${payloadId}`);
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

      case ExecutePayloadStatus.INVALID_TERMINAL_BLOCK:
        throw Error(
          `Invalid terminal block for ${
            payloadAttributes ? "prepare payload" : "forkchoice request"
          }, validationError=${validationError ?? ""}`
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
  async getPayload(payloadId: PayloadId): Promise<bellatrix.ExecutionPayload> {
    const method = "engine_getPayloadV1";
    const executionPayloadRpc = await this.rpc.fetch<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({
      method,
      params: [payloadId],
    });

    return parseExecutionPayload(executionPayloadRpc);
  }
}

/* eslint-disable @typescript-eslint/naming-convention */

type EngineApiRpcParamTypes = {
  /**
   * 1. Object - Instance of ExecutionPayload
   */
  engine_newPayloadV1: [ExecutionPayloadRpc];
  /**
   * 1. Object - Payload validity status with respect to the consensus rules:
   *   - blockHash: DATA, 32 Bytes - block hash value of the payload
   *   - status: String: VALID|INVALID - result of the payload validation with respect to the proof-of-stake consensus rules
   */
  engine_forkchoiceUpdatedV1: [
    param1: {headBlockHash: DATA; safeBlockHash: DATA; finalizedBlockHash: DATA},
    payloadAttributes?: ApiPayloadAttributes
  ];
  /**
   * 1. payloadId: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getPayloadV1: [QUANTITY];
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
  engine_forkchoiceUpdatedV1: {
    payloadStatus: {status: ForkChoiceUpdateStatus; latestValidHash: DATA | null; validationError: string | null};
    payloadId: QUANTITY | null;
  };
  /**
   * payloadId | Error: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getPayloadV1: ExecutionPayloadRpc;
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
};

export function serializeExecutionPayload(data: bellatrix.ExecutionPayload): ExecutionPayloadRpc {
  return {
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
}

export function parseExecutionPayload(data: ExecutionPayloadRpc): bellatrix.ExecutionPayload {
  return {
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
    extraData: dataToBytes(data.extraData),
    baseFeePerGas: quantityToBigint(data.baseFeePerGas),
    blockHash: dataToBytes(data.blockHash, 32),
    transactions: data.transactions.map((tran) => dataToBytes(tran)),
  };
}
