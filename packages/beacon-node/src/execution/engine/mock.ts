import crypto from "node:crypto";
import {kzgCommitmentToVersionedHash} from "@lodestar/state-transition";
import {bellatrix, deneb, RootHex, ssz} from "@lodestar/types";
import {fromHex, toHex} from "@lodestar/utils";
import {
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_BLOB,
  ForkSeq,
  ForkExecution,
  ForkName,
  BLOB_TX_TYPE,
} from "@lodestar/params";
import {ZERO_HASH_HEX} from "../../constants/index.js";
import {ckzg} from "../../util/kzg.js";
import {quantityToNum} from "../../eth1/provider/utils.js";
import {
  EngineApiRpcParamTypes,
  EngineApiRpcReturnTypes,
  deserializePayloadAttributes,
  PayloadStatus,
  serializeBlobsBundle,
  serializeExecutionPayload,
  ExecutionPayloadRpc,
  BlobsBundleRpc,
  ExecutionPayloadBodyRpc,
} from "./types.js";
import {ExecutionPayloadStatus, PayloadIdCache} from "./interface.js";
import {JsonRpcBackend} from "./utils.js";

const INTEROP_GAS_LIMIT = 30e6;
const PRUNE_PAYLOAD_ID_AFTER_MS = 5000;

export type ExecutionEngineMockOpts = {
  genesisBlockHash: string;
  onlyPredefinedResponses?: boolean;
  capellaForkTimestamp?: number;
  denebForkTimestamp?: number;
};

type ExecutionBlock = {
  parentHash: RootHex;
  blockHash: RootHex;
  timestamp: number;
  blockNumber: number;
};

const TX_TYPE_EIP1559 = 2;

type PreparedPayload = {
  executionPayload: ExecutionPayloadRpc;
  blobsBundle: BlobsBundleRpc;
};

/**
 * Mock ExecutionEngine for fast prototyping and unit testing
 */
export class ExecutionEngineMockBackend implements JsonRpcBackend {
  // Public state to check if notifyForkchoiceUpdate() is called properly
  headBlockHash = ZERO_HASH_HEX;
  safeBlockHash = ZERO_HASH_HEX;
  finalizedBlockHash = ZERO_HASH_HEX;
  readonly payloadIdCache = new PayloadIdCache();

  /** Known valid blocks, both pre-merge and post-merge */
  private readonly validBlocks = new Map<RootHex, ExecutionBlock>();
  /** Preparing payloads to be retrieved via engine_getPayloadV1 */
  private readonly preparingPayloads = new Map<number, PreparedPayload>();
  private readonly payloadsForDeletion = new Map<number, number>();

  private readonly predefinedPayloadStatuses = new Map<RootHex, PayloadStatus>();

  private payloadId = 0;

  readonly handlers: {
    [K in keyof EngineApiRpcParamTypes]: (...args: EngineApiRpcParamTypes[K]) => EngineApiRpcReturnTypes[K];
  };

  constructor(private readonly opts: ExecutionEngineMockOpts) {
    this.validBlocks.set(opts.genesisBlockHash, {
      parentHash: ZERO_HASH_HEX,
      blockHash: ZERO_HASH_HEX,
      timestamp: 0,
      blockNumber: 0,
    });

    this.handlers = {
      /* eslint-disable @typescript-eslint/naming-convention */
      engine_newPayloadV1: this.notifyNewPayload.bind(this),
      engine_newPayloadV2: this.notifyNewPayload.bind(this),
      engine_newPayloadV3: this.notifyNewPayload.bind(this),
      engine_forkchoiceUpdatedV1: this.notifyForkchoiceUpdate.bind(this),
      engine_forkchoiceUpdatedV2: this.notifyForkchoiceUpdate.bind(this),
      engine_forkchoiceUpdatedV3: this.notifyForkchoiceUpdate.bind(this),
      engine_getPayloadV1: this.getPayload.bind(this),
      engine_getPayloadV2: this.getPayload.bind(this),
      engine_getPayloadV3: this.getPayload.bind(this),
      engine_getPayloadBodiesByHashV1: this.getPayloadBodiesByHash.bind(this),
      engine_getPayloadBodiesByRangeV1: this.getPayloadBodiesByRange.bind(this),
    };
  }

  private getPayloadBodiesByHash(
    _blockHex: EngineApiRpcParamTypes["engine_getPayloadBodiesByHashV1"][0]
  ): EngineApiRpcReturnTypes["engine_getPayloadBodiesByHashV1"] {
    return [{transactions: [], withdrawals: []}] as ExecutionPayloadBodyRpc[];
  }

  private getPayloadBodiesByRange(
    _start: EngineApiRpcParamTypes["engine_getPayloadBodiesByRangeV1"][0],
    _count: EngineApiRpcParamTypes["engine_getPayloadBodiesByRangeV1"][1]
  ): EngineApiRpcReturnTypes["engine_getPayloadBodiesByRangeV1"] {
    return [] as ExecutionPayloadBodyRpc[];
  }

  /**
   * Mock manipulator to add more known blocks to this mock.
   */
  addPowBlock(powBlock: bellatrix.PowBlock): void {
    this.validBlocks.set(toHex(powBlock.blockHash), {
      parentHash: toHex(powBlock.parentHash),
      blockHash: toHex(powBlock.blockHash),
      timestamp: 0,
      blockNumber: 0,
    });
  }

  /**
   * Mock manipulator to add predefined responses before execution engine client calls
   */
  addPredefinedPayloadStatus(blockHash: RootHex, payloadStatus: PayloadStatus): void {
    this.predefinedPayloadStatuses.set(blockHash, payloadStatus);
  }

  /**
   * `engine_newPayloadV1`
   */
  private notifyNewPayload(
    executionPayloadRpc: EngineApiRpcParamTypes["engine_newPayloadV1"][0],
    // add versionedHashes validation later if required
    _versionedHashes?: EngineApiRpcParamTypes["engine_newPayloadV3"][1]
  ): EngineApiRpcReturnTypes["engine_newPayloadV1"] {
    const blockHash = executionPayloadRpc.blockHash;
    const parentHash = executionPayloadRpc.parentHash;

    // For optimistic sync spec tests, allow to define responses ahead of time
    const predefinedResponse = this.predefinedPayloadStatuses.get(blockHash);
    if (predefinedResponse) {
      return predefinedResponse;
    } else if (this.opts.onlyPredefinedResponses) {
      throw Error(`No predefined response for blockHash ${blockHash}`);
    }

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
      return {status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null};
    }

    // 4. Client software MAY NOT validate the payload if the payload doesn't belong to the canonical chain.
    //
    // > N/A: Mock does not track the chain dag

    // Mock logic: persist valid payload as part of canonical chain

    this.validBlocks.set(blockHash, {
      parentHash,
      blockHash,
      timestamp: quantityToNum(executionPayloadRpc.timestamp),
      blockNumber: quantityToNum(executionPayloadRpc.blockNumber),
    });

    // IF the payload has been fully validated while processing the call
    // RETURN payload status from the Payload validation process
    // If validation succeeds, the response MUST contain {status: VALID, latestValidHash: payload.blockHash}
    return {status: ExecutionPayloadStatus.VALID, latestValidHash: blockHash, validationError: null};
  }

  /**
   * `engine_forkchoiceUpdatedV1`
   */
  private notifyForkchoiceUpdate(
    forkChoiceData: EngineApiRpcParamTypes["engine_forkchoiceUpdatedV1"][0],
    payloadAttributesRpc: EngineApiRpcParamTypes["engine_forkchoiceUpdatedV1"][1]
  ): EngineApiRpcReturnTypes["engine_forkchoiceUpdatedV1"] {
    const {headBlockHash, safeBlockHash, finalizedBlockHash} = forkChoiceData;

    // For optimistic sync spec tests, allow to define responses ahead of time
    const predefinedResponse = this.predefinedPayloadStatuses.get(headBlockHash);
    if (predefinedResponse) {
      return {
        payloadStatus: predefinedResponse,
        payloadId: null,
      };
    } else if (this.opts.onlyPredefinedResponses) {
      throw Error(`No predefined response for headBlockHash ${headBlockHash}`);
    }

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
      return {
        payloadStatus: {status: ExecutionPayloadStatus.SYNCING, latestValidHash: null, validationError: null},
        payloadId: null,
      };
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

    if (payloadAttributesRpc) {
      const payloadAttributes = deserializePayloadAttributes(payloadAttributesRpc);

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

      // Generate empty payload first to be correct with respect to fork
      const fork = this.timestampToFork(payloadAttributes.timestamp);
      const executionPayload = ssz[fork].ExecutionPayload.defaultValue();

      // Make executionPayload valid
      executionPayload.parentHash = fromHex(headBlockHash);
      executionPayload.feeRecipient = fromHex(payloadAttributes.suggestedFeeRecipient);
      executionPayload.prevRandao = payloadAttributes.prevRandao;
      executionPayload.blockNumber = headBlock.blockNumber + 1;
      executionPayload.gasLimit = INTEROP_GAS_LIMIT;
      executionPayload.gasUsed = Math.floor(0.5 * INTEROP_GAS_LIMIT);
      executionPayload.timestamp = payloadAttributes.timestamp;
      executionPayload.blockHash = crypto.randomBytes(32);
      executionPayload.transactions = [];

      // Between 0 and 4 transactions for all forks
      const eip1559TxCount = Math.round(4 * Math.random());
      for (let i = 0; i < eip1559TxCount; i++) {
        const tx = crypto.randomBytes(512);
        tx[0] = TX_TYPE_EIP1559;
        executionPayload.transactions.push(tx);
      }

      const commitments: deneb.KZGCommitment[] = [];
      const blobs: deneb.Blob[] = [];
      const proofs: deneb.KZGProof[] = [];

      // if post deneb, add between 0 and 2 blob transactions
      if (ForkSeq[fork] >= ForkSeq.deneb) {
        const denebTxCount = Math.round(2 * Math.random());
        for (let i = 0; i < denebTxCount; i++) {
          const blob = generateRandomBlob();
          const commitment = ckzg.blobToKzgCommitment(blob);
          const proof = ckzg.computeBlobKzgProof(blob, commitment);
          executionPayload.transactions.push(transactionForKzgCommitment(commitment));
          commitments.push(commitment);
          blobs.push(blob);
          proofs.push(proof);
        }
      }

      this.preparingPayloads.set(payloadId, {
        executionPayload: serializeExecutionPayload(fork, executionPayload),
        blobsBundle: serializeBlobsBundle({
          commitments,
          blobs,
          proofs,
        }),
      });

      // IF the payload is deemed VALID and the build process has begun
      // {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash, validationError: null}, payloadId: buildProcessId}
      return {
        payloadStatus: {status: ExecutionPayloadStatus.VALID, latestValidHash: null, validationError: null},
        payloadId: String(payloadId as number),
      };
    }

    // Don't start build process
    else {
      // IF the payload is deemed VALID and a build process hasn't been started
      // {payloadStatus: {status: VALID, latestValidHash: forkchoiceState.headBlockHash, validationError: null}, payloadId: null}
      return {
        payloadStatus: {status: ExecutionPayloadStatus.VALID, latestValidHash: null, validationError: null},
        payloadId: null,
      };
    }
  }

  /**
   * `engine_getPayloadV1`
   *
   * 1. Given the payloadId client software MUST respond with the most recent version of the payload that is available in the corresponding building process at the time of receiving the call.
   * 2. The call MUST be responded with 5: Unavailable payload error if the building process identified by the payloadId doesn't exist.
   * 3. Client software MAY stop the corresponding building process after serving this call.
   */
  private getPayload(
    payloadId: EngineApiRpcParamTypes["engine_getPayloadV1"][0]
  ): EngineApiRpcReturnTypes["engine_getPayloadV1"] {
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
    // Do after a while to allow getBlobsBundle()
    const now = Date.now();
    for (const [oldPayloadId, addedTimestampMs] of this.payloadsForDeletion.entries()) {
      if (addedTimestampMs < now - PRUNE_PAYLOAD_ID_AFTER_MS) {
        this.preparingPayloads.delete(oldPayloadId);
        this.payloadsForDeletion.delete(oldPayloadId);
      }
    }
    this.payloadsForDeletion.set(payloadIdNbr, now);

    return payload.executionPayload;
  }

  private timestampToFork(timestamp: number): ForkExecution {
    if (timestamp > (this.opts.denebForkTimestamp ?? Infinity)) return ForkName.deneb;
    if (timestamp > (this.opts.capellaForkTimestamp ?? Infinity)) return ForkName.capella;
    return ForkName.bellatrix;
  }
}

function transactionForKzgCommitment(kzgCommitment: deneb.KZGCommitment): bellatrix.Transaction {
  // Just use versionedHash as the transaction encoding to mock newPayloadV3 verification
  // prefixed with BLOB_TX_TYPE
  const transaction = new Uint8Array(33);
  const versionedHash = kzgCommitmentToVersionedHash(kzgCommitment);
  transaction[0] = BLOB_TX_TYPE;
  transaction.set(versionedHash, 1);
  return transaction;
}

/**
 * Generate random blob of sequential integers such that each element is < BLS_MODULUS
 */
function generateRandomBlob(): deneb.Blob {
  const blob = new Uint8Array(FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB; i++) {
    dv.setUint32(i * BYTES_PER_FIELD_ELEMENT, i);
  }
  return blob;
}
