import crypto from "node:crypto";
import {bellatrix, RootHex} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {BYTES_PER_LOGS_BLOOM} from "@lodestar/params";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../constants/index.js";
import {
  ExecutePayloadStatus,
  ExecutePayloadResponse,
  IExecutionEngine,
  PayloadId,
  PayloadAttributes,
  PayloadIdCache,
  TransitionConfigurationV1,
  BlobsBundle,
} from "./interface.js";
const INTEROP_GAS_LIMIT = 30e6;

export type ExecutionEngineMockOpts = {
  genesisBlockHash: string;
};

type ExecutionBlock = {
  parentHash: RootHex;
  blockHash: RootHex;
  timestamp: number;
  blockNumber: number;
};

/**
 * Mock ExecutionEngine for fast prototyping and unit testing
 */
export class ExecutionEngineMock implements IExecutionEngine {
  // Public state to check if notifyForkchoiceUpdate() is called properly
  headBlockHash = ZERO_HASH_HEX;
  safeBlockHash = ZERO_HASH_HEX;
  finalizedBlockHash = ZERO_HASH_HEX;
  readonly payloadIdCache = new PayloadIdCache();

  /** Known valid blocks, both pre-merge and post-merge */
  private readonly validBlocks = new Map<RootHex, ExecutionBlock>();
  /** Preparing payloads to be retrieved via engine_getPayloadV1 */
  private readonly preparingPayloads = new Map<number, bellatrix.ExecutionPayload>();

  private payloadId = 0;

  constructor(opts: ExecutionEngineMockOpts) {
    this.validBlocks.set(opts.genesisBlockHash, {
      parentHash: ZERO_HASH_HEX,
      blockHash: ZERO_HASH_HEX,
      timestamp: 0,
      blockNumber: 0,
    });
  }

  /**
   * `engine_newPayloadV1`
   */
  async notifyNewPayload(executionPayload: bellatrix.ExecutionPayload): Promise<ExecutePayloadResponse> {
    const blockHash = toHex(executionPayload.blockHash);
    const parentHash = toHex(executionPayload.parentHash);

    // 1. Client software MUST validate blockHash value as being equivalent to Keccak256(RLP(ExecutionBlockHeader)),
    //    where ExecutionBlockHeader is the execution layer block header (the former PoW block header structure).
    //    Fields of this object are set to the corresponding payload values and constant values according to the Block
    //    structure section of EIP-3675, extended with the corresponding section of EIP-4399. Client software MUST run
    //    this validation in all cases even if this branch or any other branches of the block tree are in an active sync
    //    process.
    //
    // > Mock does not do this validation

    // 2. Client software MAY initiate a sync process if requisite data for payload validation is missing. Sync process
    // is specified in the Sync section.
    //
    // > N/A: Mock can't sync

    // 3. Client software MUST validate the payload if it extends the canonical chain and requisite data for the
    //    validation is locally available. The validation process is specified in the Payload validation section.
    //
    // > Mock only validates that parent is known
    if (!this.validBlocks.has(parentHash)) {
      // if requisite data for the payload's acceptance or validation is missing
      // return {status: SYNCING, latestValidHash: null, validationError: null}
      return {status: ExecutePayloadStatus.SYNCING, latestValidHash: null, validationError: null};
    }

    // 4. Client software MAY NOT validate the payload if the payload doesn't belong to the canonical chain.
    //
    // > N/A: Mock does not track the chain dag

    // Mock logic: persist valid payload as part of canonical chain

    this.validBlocks.set(blockHash, {
      parentHash,
      blockHash,
      timestamp: executionPayload.timestamp,
      blockNumber: executionPayload.blockNumber,
    });

    // IF the payload has been fully validated while processing the call
    // RETURN payload status from the Payload validation process
    // If validation succeeds, the response MUST contain {status: VALID, latestValidHash: payload.blockHash}
    return {status: ExecutePayloadStatus.VALID, latestValidHash: blockHash, validationError: null};
  }

  /**
   * `engine_forkchoiceUpdatedV1`
   */
  async notifyForkchoiceUpdate(
    headBlockHash: RootHex,
    safeBlockHash: RootHex,
    finalizedBlockHash: RootHex,
    payloadAttributes?: PayloadAttributes
  ): Promise<PayloadId | null> {
    // 1. Client software MAY initiate a sync process if forkchoiceState.headBlockHash references an unknown payload or
    //    a payload that can't be validated because data that are requisite for the validation is missing. The sync
    //    process is specified in the Sync section.
    //
    // > N/A: Mock can't sync

    // 2. Client software MAY skip an update of the forkchoice state and MUST NOT begin a payload build process if
    //    forkchoiceState.headBlockHash references an ancestor of the head of canonical chain. In the case of such an
    //    event, client software MUST return {payloadStatus:
    //    {status: VALID, latestValidHash: forkchoiceState.headBlockHash, validationError: null}, payloadId: null}.
    //
    // > TODO

    // 3. If forkchoiceState.headBlockHash references a PoW block, client software MUST validate this block with
    //    respect to terminal block conditions according to EIP-3675. This check maps to the transition block validity
    //    section of the EIP. Additionally, if this validation fails, client software MUST NOT update the forkchoice
    //    state and MUST NOT begin a payload build process.
    //
    // > TODO

    // 4. Before updating the forkchoice state, client software MUST ensure the validity of the payload referenced by
    //    forkchoiceState.headBlockHash, and MAY validate the payload while processing the call. The validation process
    //    is specified in the Payload validation section. If the validation process fails, client software MUST NOT
    //    update the forkchoice state and MUST NOT begin a payload build process.
    //
    // > N/A payload already validated
    const headBlock = this.validBlocks.get(headBlockHash);
    if (!headBlock) {
      // IF references an unknown payload or a payload that can't be validated because requisite data is missing
      // RETURN {payloadStatus: {status: SYNCING, latestValidHash: null, validationError: null}, payloadId: null}
      //
      // > TODO: Implement

      throw Error(`Unknown headBlock ${headBlockHash}`);
    }

    // 5. Client software MUST update its forkchoice state if payloads referenced by forkchoiceState.headBlockHash and
    //    forkchoiceState.finalizedBlockHash are VALID.
    if (!this.validBlocks.has(finalizedBlockHash)) {
      throw Error(`Unknown finalizedBlockHash ${finalizedBlockHash}`);
    }
    this.headBlockHash = headBlockHash;
    this.safeBlockHash = safeBlockHash;
    this.finalizedBlockHash = finalizedBlockHash;

    // 6. Client software MUST return -38002: Invalid forkchoice state error if the payload referenced by
    //    forkchoiceState.headBlockHash is VALID and a payload referenced by either forkchoiceState.finalizedBlockHash
    //    or forkchoiceState.safeBlockHash does not belong to the chain defined by forkchoiceState.headBlockHash.
    //
    // > N/A: Mock does not track the chain dag

    if (payloadAttributes) {
      // 7. Client software MUST ensure that payloadAttributes.timestamp is greater than timestamp of a block referenced
      //    by forkchoiceState.headBlockHash. If this condition isn't held client software MUST respond with
      //   `-38003: Invalid payload attributes` and MUST NOT begin a payload build process.
      //    In such an event, the forkchoiceState update MUST NOT be rolled back.
      if (headBlock.timestamp > payloadAttributes.timestamp) {
        throw Error("Invalid payload attributes");
      }

      // 8. Client software MUST begin a payload build process building on top of forkchoiceState.headBlockHash and
      //    identified via buildProcessId value if payloadAttributes is not null and the forkchoice state has been
      //    updated successfully. The build process is specified in the Payload building section.
      const payloadId = this.payloadId++;
      this.preparingPayloads.set(payloadId, {
        parentHash: fromHex(headBlockHash),
        feeRecipient: fromHex(payloadAttributes.suggestedFeeRecipient),
        stateRoot: crypto.randomBytes(32),
        receiptsRoot: crypto.randomBytes(32),
        logsBloom: crypto.randomBytes(BYTES_PER_LOGS_BLOOM),
        prevRandao: payloadAttributes.prevRandao,
        blockNumber: headBlock.blockNumber + 1,
        gasLimit: INTEROP_GAS_LIMIT,
        gasUsed: Math.floor(0.5 * INTEROP_GAS_LIMIT),
        timestamp: payloadAttributes.timestamp,
        extraData: ZERO_HASH,
        baseFeePerGas: BigInt(0),
        blockHash: crypto.randomBytes(32),
        transactions: [crypto.randomBytes(512)],
      });

      // IF the payload is deemed VALID and the build process has begun
      // {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash, validationError: null}, payloadId: buildProcessId}
      return String(payloadId as number);
    }

    // Don't start build process
    else {
      // IF the payload is deemed VALID and a build process hasn't been started
      // {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash, validationError: null}, payloadId: null}
      return null;
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
    // 1. Given the payloadId client software MUST return the most recent version of the payload that is available in
    //    the corresponding build process at the time of receiving the call.
    const payloadIdNbr = Number(payloadId);
    const payload = this.preparingPayloads.get(payloadIdNbr);

    // 2. The call MUST return -38001: Unknown payload error if the build process identified by the payloadId does not
    //    exist.
    if (!payload) {
      throw Error(`Unknown payloadId ${payloadId}`);
    }

    // 3. Client software MAY stop the corresponding build process after serving this call.
    this.preparingPayloads.delete(payloadIdNbr);

    return payload;
  }

  async getBlobsBundle(payloadId: PayloadId): Promise<BlobsBundle> {
    const payloadIdNbr = Number(payloadId);
    const payload = this.preparingPayloads.get(payloadIdNbr);

    if (!payload) {
      throw Error(`Unknown payloadId ${payloadId}`);
    }

    return {
      blockHash: "",
      kzgs: [],
      blobs: [],
      aggregatedProof: "",
    };
  }

  async exchangeTransitionConfigurationV1(
    transitionConfiguration: TransitionConfigurationV1
  ): Promise<TransitionConfigurationV1> {
    // echo same configuration from consensus, which will be considered valid
    return transitionConfiguration;
  }

  /**
   * Non-spec method just to add more known blocks to this mock.
   */
  addPowBlock(powBlock: bellatrix.PowBlock): void {
    this.validBlocks.set(toHex(powBlock.blockHash), {
      parentHash: toHex(powBlock.parentHash),
      blockHash: toHex(powBlock.blockHash),
      timestamp: 0,
      blockNumber: 0,
    });
  }
}
