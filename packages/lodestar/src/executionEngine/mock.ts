import crypto from "node:crypto";
import {bellatrix, RootHex, Root, Epoch, ValidatorIndex, ExecutionAddress} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {BYTES_PER_LOGS_BLOOM} from "@chainsafe/lodestar-params";

import {ZERO_HASH, ZERO_HASH_HEX} from "../constants";
import {
  ExecutePayloadStatus,
  ExecutePayloadResponse,
  IExecutionEngine,
  PayloadId,
  PayloadAttributes,
  ProposerPreparationData,
} from "./interface";
import {MapDef} from "../util/map";

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
  readonly proposers: MapDef<ValidatorIndex, {epoch: Epoch; feeRecipient: ExecutionAddress}>;

  private knownBlocks = new Map<RootHex, bellatrix.ExecutionPayload>();
  private preparingPayloads = new Map<number, bellatrix.ExecutionPayload>();
  private payloadId = 0;

  constructor(opts: ExecutionEngineMockOpts) {
    this.proposers = new MapDef<ValidatorIndex, {epoch: Epoch; feeRecipient: ExecutionAddress}>(() => ({
      epoch: 0,
      feeRecipient: Buffer.alloc(20, 0),
    }));
    this.knownBlocks.set(opts.genesisBlockHash, {
      parentHash: ZERO_HASH,
      feeRecipient: Buffer.alloc(20, 0),
      stateRoot: ZERO_HASH,
      receiptsRoot: ZERO_HASH,
      logsBloom: Buffer.alloc(BYTES_PER_LOGS_BLOOM, 0),
      prevRandao: ZERO_HASH,
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
   * `engine_newPayloadV1`
   *
   * 1. Client software MUST validate the payload according to the execution environment rule set with modifications to this rule set defined in the Block Validity section of EIP-3675 and respond with the validation result.
   * 2. Client software MUST defer persisting a valid payload until the corresponding engine_consensusValidated message deems the payload valid with respect to the proof-of-stake consensus rules.
   * 3. Client software MUST discard the payload if it's deemed invalid.
   * 4. The call MUST be responded with SYNCING status while the sync process is in progress and thus the execution cannot yet be validated.
   * 5. In the case when the parent block is unknown, client software MUST pull the block from the network and take one of the following actions depending on the parent block properties:
   * 6. If the parent block is a PoW block as per EIP-3675 definition, then all missing dependencies of the payload MUST be pulled from the network and validated accordingly. The call MUST be responded according to the validity of the payload and the chain of its ancestors.
   *    If the parent block is a PoS block as per EIP-3675 definition, then the call MAY be responded with SYNCING status and sync process SHOULD be initiated accordingly.
   */
  async notifyNewPayload(executionPayload: bellatrix.ExecutionPayload): Promise<ExecutePayloadResponse> {
    // Only validate that parent is known
    if (!this.knownBlocks.has(toHexString(executionPayload.parentHash))) {
      return {status: ExecutePayloadStatus.INVALID, latestValidHash: this.headBlockRoot, validationError: null};
    }

    this.knownBlocks.set(toHexString(executionPayload.blockHash), executionPayload);
    return {
      status: ExecutePayloadStatus.VALID,
      latestValidHash: toHexString(executionPayload.blockHash),
      validationError: null,
    };
  }

  /**
   * `engine_forkchoiceUpdated`
   *
   * 1. This method call maps on the POS_FORKCHOICE_UPDATED event of EIP-3675 and MUST be processed according to the specification defined in the EIP.
   * 2. Client software MUST respond with 4: Unknown block error if the payload identified by either the headBlockHash or the finalizedBlockHash is unknown.
   */
  async notifyForkchoiceUpdate(
    headBlockHash: Root,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<PayloadId> {
    const headBlockHashHex = toHexString(headBlockHash);
    if (!this.knownBlocks.has(headBlockHashHex)) {
      throw Error(`Unknown headBlockHash ${headBlockHashHex}`);
    }
    if (!this.knownBlocks.has(finalizedBlockHash)) {
      throw Error(`Unknown finalizedBlockHash ${finalizedBlockHash}`);
    }

    this.headBlockRoot = headBlockHashHex;
    this.finalizedBlockRoot = finalizedBlockHash;

    const parentHashHex = headBlockHashHex;
    const parentPayload = this.knownBlocks.get(parentHashHex);
    if (!parentPayload) {
      throw Error(`Unknown parentHash ${parentHashHex}`);
    }

    if (!payloadAttributes) throw Error("InvalidPayloadAttributes");

    const payloadId = this.payloadId++;
    const payload: bellatrix.ExecutionPayload = {
      parentHash: headBlockHash,
      feeRecipient: payloadAttributes.suggestedFeeRecipient,
      stateRoot: crypto.randomBytes(32),
      receiptsRoot: crypto.randomBytes(32),
      logsBloom: crypto.randomBytes(BYTES_PER_LOGS_BLOOM),
      prevRandao: payloadAttributes.prevRandao,
      blockNumber: parentPayload.blockNumber + 1,
      gasLimit: INTEROP_GAS_LIMIT,
      gasUsed: Math.floor(0.5 * INTEROP_GAS_LIMIT),
      timestamp: payloadAttributes.timestamp,
      extraData: ZERO_HASH,
      baseFeePerGas: BigInt(0),
      blockHash: crypto.randomBytes(32),
      transactions: [crypto.randomBytes(512)],
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
  async getPayload(payloadId: PayloadId): Promise<bellatrix.ExecutionPayload> {
    const payloadIdNbr = Number(payloadId);
    const payload = this.preparingPayloads.get(payloadIdNbr);
    if (!payload) {
      throw Error(`Unknown payloadId ${payloadId}`);
    }
    this.preparingPayloads.delete(payloadIdNbr);
    return payload;
  }

  async updateProposerPreparation(_epoch: Epoch, _proposers: ProposerPreparationData[]): Promise<void> {
    return;
  }
}
