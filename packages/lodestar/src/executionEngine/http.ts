import {AbortSignal} from "@chainsafe/abort-controller";
import {merge, RootHex, Root} from "@chainsafe/lodestar-types";
import {BYTES_PER_LOGS_BLOOM} from "@chainsafe/lodestar-params";

import {JsonRpcHttpClient} from "../eth1/provider/jsonRpcHttpClient";
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
      });
  }

  /**
   * `engine_executePayloadV1`
   *
   * 1. Client software MUST validate the payload according to the execution environment rule set with modifications to this rule set defined in the Block Validity section of EIP-3675 and respond with the validation result.
   * 2. Client software MUST defer persisting a valid payload until the corresponding engine_consensusValidated message deems the payload valid with respect to the proof-of-stake consensus rules.
   * 3. Client software MUST discard the payload if it's deemed invalid.
   * 4. The call MUST be responded with SYNCING status while the sync process is in progress and thus the execution cannot yet be validated.
   * 5. In the case when the parent block is unknown, client software MUST pull the block from the network and take one of the following actions depending on the parent block properties:
   * 6. If the parent block is a PoW block as per EIP-3675 definition, then all missing dependencies of the payload MUST be pulled from the network and validated accordingly. The call MUST be responded according to the validity of the payload and the chain of its ancestors.
   *    If the parent block is a PoS block as per EIP-3675 definition, then the call MAY be responded with SYNCING status and sync process SHOULD be initiated accordingly.
   */
  async executePayload(executionPayload: merge.ExecutionPayload): Promise<ExecutePayloadResponse> {
    const method = "engine_executePayloadV1";
    const serializedExecutionPayload = serializeExecutionPayload(executionPayload);
    const {status, latestValidHash, validationError} = await this.rpc
      .fetch<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>({
        method,
        params: [serializedExecutionPayload],
      })
      /**
       * If there are errors by EL like connection refused, internal error, they need to be
       * treated seperate from being INVALID. For now, just pass the error upstream.
       */
      .catch((e: Error) => ({status: ExecutePayloadStatus.ELERROR, latestValidHash: null, validationError: e.message}));

    let execResponse: ExecutePayloadResponse;

    // Validate status is known
    const statusEnum = ExecutePayloadStatus[status];
    switch (statusEnum) {
      case ExecutePayloadStatus.VALID:
        if (latestValidHash == null) {
          execResponse = {
            status: ExecutePayloadStatus.ELERROR,
            latestValidHash: null,
            validationError: `Invalid null latestValidHash for status=${status}`,
          };
        } else {
          execResponse = {status: statusEnum, latestValidHash, validationError: null};
        }
        break;
      case ExecutePayloadStatus.INVALID:
        if (latestValidHash == null) {
          execResponse = {
            status: ExecutePayloadStatus.ELERROR,
            latestValidHash: null,
            validationError: `Invalid null latestValidHash for status=${status}`,
          };
        } else {
          execResponse = {status: statusEnum, latestValidHash, validationError};
        }
        break;
      case ExecutePayloadStatus.SYNCING:
        execResponse = {status: statusEnum, latestValidHash, validationError: null};
        break;
      case ExecutePayloadStatus.ELERROR:
        execResponse = {
          status: statusEnum,
          latestValidHash: null,
          validationError: validationError ?? "Unidentified ELERROR",
        };
        break;
      default:
        execResponse = {
          status: ExecutePayloadStatus.ELERROR,
          latestValidHash: null,
          validationError: `Invalid EL status on executePayload: ${status}`,
        };
    }
    return execResponse;
  }

  /**
   * `engine_forkchoiceUpdated`
   *
   * 1. This method call maps on the POS_FORKCHOICE_UPDATED event of EIP-3675 and MUST be processed according to the specification defined in the EIP.
   * 2. Client software MUST respond with 4: Unknown block error if the payload identified by either the headBlockHash or the finalizedBlockHash is unknown.
   */
  notifyForkchoiceUpdate(
    headBlockHash: Root | RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<PayloadId | null> {
    const method = "engine_forkchoiceUpdatedV1";
    const headBlockHashData = typeof headBlockHash === "string" ? headBlockHash : bytesToData(headBlockHash);
    const apiPayloadAttributes: [input?: ApiPayloadAttributes] = payloadAttributes
      ? [
          {
            timestamp: numToQuantity(payloadAttributes.timestamp),
            random: bytesToData(payloadAttributes.random),
            suggestedFeeRecipient: bytesToData(payloadAttributes.suggestedFeeRecipient),
          },
        ]
      : [];
    return this.rpc
      .fetch<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>({
        method,
        params: [
          {headBlockHash: headBlockHashData, safeBlockHash: headBlockHashData, finalizedBlockHash},
          ...apiPayloadAttributes,
        ],
      })
      .then(({status, payloadId}) => {
        // Validate status is known
        const statusEnum = ForkChoiceUpdateStatus[status];
        if (statusEnum === undefined) {
          throw Error(`Unknown status ${status}`);
        }

        // Throw error on syncing if requested to produce a block, else silently ignore
        if (payloadAttributes && statusEnum === ForkChoiceUpdateStatus.SYNCING) throw Error("Execution Layer Syncing");

        return payloadId !== "0x" ? payloadId : null;
      });
  }

  /**
   * `engine_getPayloadV1`
   *
   * 1. Given the payloadId client software MUST respond with the most recent version of the payload that is available in the corresponding building process at the time of receiving the call.
   * 2. The call MUST be responded with 5: Unavailable payload error if the building process identified by the payloadId doesn't exist.
   * 3. Client software MAY stop the corresponding building process after serving this call.
   */
  async getPayload(payloadId: PayloadId): Promise<merge.ExecutionPayload> {
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
  engine_executePayloadV1: [ExecutionPayloadRpc];
  /**
   * 1. Object - Payload validity status with respect to the consensus rules:
   *   - blockHash: DATA, 32 Bytes - block hash value of the payload
   *   - status: String: VALID|INVALID - result of the payload validation with respect to the proof-of-stake consensus rules
   */
  engine_consensusValidated: [{blockHash: DATA; status: "VALID" | "INVALID"}];
  /**
   * 1. Object - The state of the fork choice:
   *   - headBlockHash: DATA, 32 Bytes - block hash of the head of the canonical chain
   *   - finalizedBlockHash: DATA, 32 Bytes - block hash of the most recent finalized block
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
  engine_executePayloadV1: {
    status: ExecutePayloadStatus.VALID | ExecutePayloadStatus.INVALID | ExecutePayloadStatus.SYNCING;
    latestValidHash: DATA | null;
    validationError: string | null;
  };
  engine_consensusValidated: void;
  engine_forkchoiceUpdatedV1: {status: ForkChoiceUpdateStatus; payloadId: QUANTITY};
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
  random: DATA; // 32 bytes
  blockNumber: QUANTITY;
  gasLimit: QUANTITY;
  gasUsed: QUANTITY;
  timestamp: QUANTITY;
  extraData: DATA; // 0 to 32 bytes
  baseFeePerGas: QUANTITY;
  blockHash: DATA; // 32 bytes
  transactions: DATA[];
};

export function serializeExecutionPayload(data: merge.ExecutionPayload): ExecutionPayloadRpc {
  return {
    parentHash: bytesToData(data.parentHash),
    feeRecipient: bytesToData(data.feeRecipient),
    stateRoot: bytesToData(data.stateRoot),
    receiptsRoot: bytesToData(data.receiptsRoot),
    logsBloom: bytesToData(data.logsBloom),
    random: bytesToData(data.random),
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

export function parseExecutionPayload(data: ExecutionPayloadRpc): merge.ExecutionPayload {
  return {
    parentHash: dataToBytes(data.parentHash, 32),
    feeRecipient: dataToBytes(data.feeRecipient, 20),
    stateRoot: dataToBytes(data.stateRoot, 32),
    receiptsRoot: dataToBytes(data.receiptsRoot, 32),
    logsBloom: dataToBytes(data.logsBloom, BYTES_PER_LOGS_BLOOM),
    random: dataToBytes(data.random, 32),
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
