import crypto from "crypto";
import {Bytes32, merge, Root, ExecutionAddress, RootHex} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {ZERO_HASH, ZERO_HASH_HEX} from "../constants";
import {ExecutePayloadStatus, IExecutionEngine, PayloadId} from "./interface";
import {BYTES_PER_LOGS_BLOOM} from "@chainsafe/lodestar-params";

const INTEROP_GAS_LIMIT = 30e6;

export type ExecutionEngineMockOpts = {
  genesisBlockHash: string;
};

/**
 * Mock ExecutionEngine for fast prototyping and unit testing
 */
export class ExecutionEngineMock implements IExecutionEngine {
  // Public state to check if notifyForkchoiceUpdate() is called properly
  headBlockRoot = ZERO_HASH_HEX;
  finalizedBlockRoot = ZERO_HASH_HEX;

  private knownBlocks = new Map<RootHex, merge.ExecutionPayload>();
  private preparingPayloads = new Map<number, merge.ExecutionPayload>();
  private payloadId = 0;

  constructor(opts: ExecutionEngineMockOpts) {
    this.knownBlocks.set(opts.genesisBlockHash, {
      parentHash: ZERO_HASH,
      coinbase: Buffer.alloc(20, 0),
      stateRoot: ZERO_HASH,
      receiptRoot: ZERO_HASH,
      logsBloom: Buffer.alloc(BYTES_PER_LOGS_BLOOM, 0),
      random: ZERO_HASH,
      blockNumber: 0,
      gasLimit: INTEROP_GAS_LIMIT,
      gasUsed: 0,
      timestamp: 0,
      extraData: ZERO_HASH,
      baseFeePerGas: BigInt(0),
      blockHash: ZERO_HASH,
      transactions: [],
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
    // Only validate that parent is known
    if (!this.knownBlocks.has(toHexString(executionPayload.parentHash))) {
      return ExecutePayloadStatus.INVALID;
    }

    this.knownBlocks.set(toHexString(executionPayload.blockHash), executionPayload);
    return ExecutePayloadStatus.VALID;
  }

  /**
   * `engine_forkchoiceUpdated`
   *
   * 1. This method call maps on the POS_FORKCHOICE_UPDATED event of EIP-3675 and MUST be processed according to the specification defined in the EIP.
   * 2. Client software MUST respond with 4: Unknown block error if the payload identified by either the headBlockHash or the finalizedBlockHash is unknown.
   */
  async notifyForkchoiceUpdate(headBlockHash: RootHex, finalizedBlockHash: RootHex): Promise<void> {
    if (!this.knownBlocks.has(headBlockHash)) {
      throw Error(`Unknown headBlockHash ${headBlockHash}`);
    }
    if (!this.knownBlocks.has(finalizedBlockHash)) {
      throw Error(`Unknown finalizedBlockHash ${finalizedBlockHash}`);
    }

    this.headBlockRoot = headBlockHash;
    this.finalizedBlockRoot = finalizedBlockHash;
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
    const parentHashHex = toHexString(parentHash);
    const parentPayload = this.knownBlocks.get(parentHashHex);
    if (!parentPayload) {
      throw Error(`Unknown parentHash ${parentHashHex}`);
    }

    const payloadId = this.payloadId++;
    const payload: merge.ExecutionPayload = {
      parentHash: parentHash,
      coinbase: feeRecipient,
      stateRoot: crypto.randomBytes(32),
      receiptRoot: crypto.randomBytes(32),
      logsBloom: crypto.randomBytes(BYTES_PER_LOGS_BLOOM),
      random: random,
      blockNumber: parentPayload.blockNumber + 1,
      gasLimit: INTEROP_GAS_LIMIT,
      gasUsed: Math.floor(0.5 * INTEROP_GAS_LIMIT),
      timestamp: timestamp,
      extraData: ZERO_HASH,
      baseFeePerGas: BigInt(0),
      blockHash: crypto.randomBytes(32),
      transactions: [{selector: 0, value: crypto.randomBytes(512)}],
    };
    this.preparingPayloads.set(payloadId, payload);

    return payloadId.toString();
  }

  /**
   * `engine_getPayload`
   *
   * 1. Given the payloadId client software MUST respond with the most recent version of the payload that is available in the corresponding building process at the time of receiving the call.
   * 2. The call MUST be responded with 5: Unavailable payload error if the building process identified by the payloadId doesn't exist.
   * 3. Client software MAY stop the corresponding building process after serving this call.
   */
  async getPayload(payloadId: PayloadId): Promise<merge.ExecutionPayload> {
    const payloadIdNbr = Number(payloadId);
    const payload = this.preparingPayloads.get(payloadIdNbr);
    if (!payload) {
      throw Error(`Unknown payloadId ${payloadId}`);
    }
    this.preparingPayloads.delete(payloadIdNbr);
    return payload;
  }
}
