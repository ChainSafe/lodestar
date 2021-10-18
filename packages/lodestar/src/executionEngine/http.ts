import {AbortSignal} from "@chainsafe/abort-controller";
import {Bytes32, merge, Root, ExecutionAddress, RootHex} from "@chainsafe/lodestar-types";
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
import {ExecutePayloadStatus, IExecutionEngine, PayloadId} from "./interface";
import {BYTES_PER_LOGS_BLOOM} from "@chainsafe/lodestar-params";

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
   * `engine_executePayload`
   *
   * 1. Client software MUST validate the payload according to the execution environment rule set with modifications to this rule set defined in the Block Validity section of EIP-3675 and respond with the validation result.
   * 2. Client software MUST defer persisting a valid payload until the corresponding engine_consensusValidated message deems the payload valid with respect to the proof-of-stake consensus rules.
   * 3. Client software MUST discard the payload if it's deemed invalid.
   * 4. The call MUST be responded with SYNCING status while the sync process is in progress and thus the execution cannot yet be validated.
   * 5. In the case when the parent block is unknown, client software MUST pull the block from the network and take one of the following actions depending on the parent block properties:
   * 6. If the parent block is a PoW block as per EIP-3675 definition, then all missing dependencies of the payload MUST be pulled from the network and validated accordingly. The call MUST be responded according to the validity of the payload and the chain of its ancestors.
   *    If the parent block is a PoS block as per EIP-3675 definition, then the call MAY be responded with SYNCING status and sync process SHOULD be initiated accordingly.
   */
  async executePayload(executionPayload: merge.ExecutionPayload): Promise<ExecutePayloadStatus> {
    const method = "engine_executePayload";
    const {status} = await this.rpc.fetch<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({
      method,
      params: [serializeExecutionPayload(executionPayload)],
    });

    // Validate status is known
    const statusEnum = ExecutePayloadStatus[status];
    if (statusEnum === undefined) {
      throw Error(`Unknown status ${status}`);
    }

    return statusEnum;
  }

  /**
   * `engine_forkchoiceUpdated`
   *
   * 1. This method call maps on the POS_FORKCHOICE_UPDATED event of EIP-3675 and MUST be processed according to the specification defined in the EIP.
   * 2. Client software MUST respond with 4: Unknown block error if the payload identified by either the headBlockHash or the finalizedBlockHash is unknown.
   */
  notifyForkchoiceUpdate(headBlockHash: RootHex, finalizedBlockHash: RootHex): Promise<void> {
    const method = "engine_forkchoiceUpdated";
    return this.rpc.fetch<EngineApiRpcReturnTypes[typeof method], EngineApiRpcParamTypes[typeof method]>({
      method,
      params: [{headBlockHash, finalizedBlockHash}],
    });
  }

  /**
   * `engine_preparePayload`
   *
   * 1. Given provided field value set client software SHOULD build the initial version of the payload which has an empty transaction set.
   * 2. Client software SHOULD start the process of updating the payload. The strategy of this process is implementation dependent. The default strategy would be to keep the transaction set up-to-date with the state of local mempool.
   * 3. Client software SHOULD stop the updating process either by finishing to serve the engine_getPayload call with the same payloadId value or when SECONDS_PER_SLOT (currently set to 12 in the Mainnet configuration) seconds have passed since the point in time identified by the timestamp parameter.
   * 4. Client software MUST set the payload field values according to the set of parameters passed in the call to this method with exception for the feeRecipient. The coinbase field value MAY deviate from what is specified by the feeRecipient parameter.
   * 5. Client software SHOULD respond with 2: Action not allowed error if the sync process is in progress.
   * 6. Client software SHOULD respond with 4: Unknown block error if the parent block is unknown.
   */
  async preparePayload(
    parentHash: Root,
    timestamp: number,
    random: Bytes32,
    feeRecipient: ExecutionAddress
  ): Promise<PayloadId> {
    const method = "engine_preparePayload";
    const {payloadId} = await this.rpc.fetch<
      EngineApiRpcReturnTypes[typeof method],
      EngineApiRpcParamTypes[typeof method]
    >({
      method,
      params: [
        {
          parentHash: bytesToData(parentHash),
          timestamp: numToQuantity(timestamp),
          random: bytesToData(random),
          feeRecipient: bytesToData(feeRecipient),
        },
      ],
    });

    return payloadId;
  }

  /**
   * `engine_getPayload`
   *
   * 1. Given the payloadId client software MUST respond with the most recent version of the payload that is available in the corresponding building process at the time of receiving the call.
   * 2. The call MUST be responded with 5: Unavailable payload error if the building process identified by the payloadId doesn't exist.
   * 3. Client software MAY stop the corresponding building process after serving this call.
   */
  async getPayload(payloadId: PayloadId): Promise<merge.ExecutionPayload> {
    const method = "engine_getPayload";
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
  engine_executePayload: [ExecutionPayloadRpc];
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
  engine_forkchoiceUpdated: [{headBlockHash: DATA; finalizedBlockHash: DATA}];
  /**
   * 1. Object - The payload attributes:
   */
  engine_preparePayload: [PayloadAttributes];
  /**
   * 1. payloadId: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getPayload: [QUANTITY];
};

type EngineApiRpcReturnTypes = {
  /**
   * Object - Response object:
   * - status: String - the result of the payload execution:
   */
  engine_executePayload: {status: ExecutePayloadStatus};
  engine_consensusValidated: void;
  engine_forkchoiceUpdated: void;
  /**
   * payloadId | Error: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_preparePayload: {payloadId: QUANTITY};
  engine_getPayload: ExecutionPayloadRpc;
};

type PayloadAttributes = {
  /** DATA, 32 Bytes - hash of the parent block */
  parentHash: DATA;
  /** QUANTITY, 64 Bits - value for the timestamp field of the new payload */
  timestamp: QUANTITY;
  /** DATA, 32 Bytes - value for the random field of the new payload */
  random: DATA;
  /** DATA, 20 Bytes - suggested value for the coinbase field of the new payload */
  feeRecipient: DATA;
};

type ExecutionPayloadRpc = {
  parentHash: DATA; // 32 bytes
  coinbase: DATA; // 20 bytes
  stateRoot: DATA; // 32 bytes
  receiptRoot: DATA; // 32 bytes
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
    coinbase: bytesToData(data.coinbase),
    stateRoot: bytesToData(data.stateRoot),
    receiptRoot: bytesToData(data.receiptRoot),
    logsBloom: bytesToData(data.logsBloom),
    random: bytesToData(data.random),
    blockNumber: numToQuantity(data.blockNumber),
    gasLimit: numToQuantity(data.gasLimit),
    gasUsed: numToQuantity(data.gasUsed),
    timestamp: numToQuantity(data.timestamp),
    extraData: bytesToData(data.extraData),
    baseFeePerGas: numToQuantity(data.baseFeePerGas),
    blockHash: bytesToData(data.blockHash),
    transactions: data.transactions.map((tran) => bytesToData(tran.value)),
  };
}

export function parseExecutionPayload(data: ExecutionPayloadRpc): merge.ExecutionPayload {
  return {
    parentHash: dataToBytes(data.parentHash, 32),
    coinbase: dataToBytes(data.coinbase, 20),
    stateRoot: dataToBytes(data.stateRoot, 32),
    receiptRoot: dataToBytes(data.receiptRoot, 32),
    logsBloom: dataToBytes(data.logsBloom, BYTES_PER_LOGS_BLOOM),
    random: dataToBytes(data.random, 32),
    blockNumber: quantityToNum(data.blockNumber),
    gasLimit: quantityToNum(data.gasLimit),
    gasUsed: quantityToNum(data.gasUsed),
    timestamp: quantityToNum(data.timestamp),
    extraData: dataToBytes(data.extraData),
    baseFeePerGas: quantityToBigint(data.baseFeePerGas),
    blockHash: dataToBytes(data.blockHash, 32),
    transactions: data.transactions.map((tran) => ({selector: 0, value: dataToBytes(tran)})),
  };
}
