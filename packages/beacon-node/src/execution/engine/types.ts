import {allForks, capella, deneb, Wei, bellatrix, Root} from "@lodestar/types";
import {
  BYTES_PER_LOGS_BLOOM,
  FIELD_ELEMENTS_PER_BLOB,
  BYTES_PER_FIELD_ELEMENT,
  ForkName,
  ForkSeq,
} from "@lodestar/params";

import {
  bytesToData,
  numToQuantity,
  dataToBytes,
  quantityToNum,
  DATA,
  QUANTITY,
  quantityToBigint,
} from "../../eth1/provider/utils.js";
import {ExecutionPayloadStatus, BlobsBundle, PayloadAttributes, VersionedHashes} from "./interface.js";
import {WithdrawalV1} from "./payloadIdCache.js";

/* eslint-disable @typescript-eslint/naming-convention */

export type EngineApiRpcParamTypes = {
  /**
   * 1. Object - Instance of ExecutionPayload
   */
  engine_newPayloadV1: [ExecutionPayloadRpc];
  engine_newPayloadV2: [ExecutionPayloadRpc];
  engine_newPayloadV3: [ExecutionPayloadRpc, VersionedHashesRpc, DATA];
  /**
   * 1. Object - Payload validity status with respect to the consensus rules:
   *   - blockHash: DATA, 32 Bytes - block hash value of the payload
   *   - status: String: VALID|INVALID - result of the payload validation with respect to the proof-of-stake consensus rules
   */
  engine_forkchoiceUpdatedV1: [
    forkChoiceData: {headBlockHash: DATA; safeBlockHash: DATA; finalizedBlockHash: DATA},
    payloadAttributes?: PayloadAttributesRpc,
  ];
  engine_forkchoiceUpdatedV2: [
    forkChoiceData: {headBlockHash: DATA; safeBlockHash: DATA; finalizedBlockHash: DATA},
    payloadAttributes?: PayloadAttributesRpc,
  ];
  engine_forkchoiceUpdatedV3: [
    forkChoiceData: {headBlockHash: DATA; safeBlockHash: DATA; finalizedBlockHash: DATA},
    payloadAttributes?: PayloadAttributesRpc,
  ];
  /**
   * 1. payloadId: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getPayloadV1: [QUANTITY];
  engine_getPayloadV2: [QUANTITY];
  engine_getPayloadV3: [QUANTITY];

  /**
   * 1. Array of DATA - Array of block_hash field values of the ExecutionPayload structure
   *  */
  engine_getPayloadBodiesByHashV1: DATA[][];

  /**
   *  1. start: QUANTITY, 64 bits - Starting block number
   *  2. count: QUANTITY, 64 bits - Number of blocks to return
   */
  engine_getPayloadBodiesByRangeV1: [start: QUANTITY, count: QUANTITY];
};

export type PayloadStatus = {
  status: ExecutionPayloadStatus;
  latestValidHash: DATA | null;
  validationError: string | null;
};

export type EngineApiRpcReturnTypes = {
  /**
   * Object - Response object:
   * - status: String - the result of the payload execution:
   */
  engine_newPayloadV1: PayloadStatus;
  engine_newPayloadV2: PayloadStatus;
  engine_newPayloadV3: PayloadStatus;
  engine_forkchoiceUpdatedV1: {
    payloadStatus: PayloadStatus;
    payloadId: QUANTITY | null;
  };
  engine_forkchoiceUpdatedV2: {
    payloadStatus: PayloadStatus;
    payloadId: QUANTITY | null;
  };
  engine_forkchoiceUpdatedV3: {
    payloadStatus: PayloadStatus;
    payloadId: QUANTITY | null;
  };
  /**
   * payloadId | Error: QUANTITY, 64 Bits - Identifier of the payload building process
   */
  engine_getPayloadV1: ExecutionPayloadRpc;
  engine_getPayloadV2: ExecutionPayloadResponse;
  engine_getPayloadV3: ExecutionPayloadResponse;

  engine_getPayloadBodiesByHashV1: (ExecutionPayloadBodyRpc | null)[];

  engine_getPayloadBodiesByRangeV1: (ExecutionPayloadBodyRpc | null)[];
};

type ExecutionPayloadRpcWithValue = {
  executionPayload: ExecutionPayloadRpc;
  // even though CL tracks this as executionPayloadValue, EL returns this as blockValue
  blockValue: QUANTITY;
  blobsBundle?: BlobsBundleRpc;
};
type ExecutionPayloadResponse = ExecutionPayloadRpc | ExecutionPayloadRpcWithValue;

export type ExecutionPayloadBodyRpc = {transactions: DATA[]; withdrawals: WithdrawalV1[] | null};

export type ExecutionPayloadBody = {transactions: bellatrix.Transaction[]; withdrawals: capella.Withdrawals | null};

export type ExecutionPayloadRpc = {
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
  withdrawals?: WithdrawalRpc[]; // Capella hardfork
  blobGasUsed?: QUANTITY; // DENEB
  excessBlobGas?: QUANTITY; // DENEB
  parentBeaconBlockRoot?: QUANTITY; // DENEB
};

export type WithdrawalRpc = {
  index: QUANTITY;
  validatorIndex: QUANTITY;
  address: DATA;
  amount: QUANTITY;
};

export type VersionedHashesRpc = DATA[];

export type PayloadAttributesRpc = {
  /** QUANTITY, 64 Bits - value for the timestamp field of the new payload */
  timestamp: QUANTITY;
  /** DATA, 32 Bytes - value for the prevRandao field of the new payload */
  prevRandao: DATA;
  /** DATA, 20 Bytes - suggested value for the coinbase field of the new payload */
  suggestedFeeRecipient: DATA;
  withdrawals?: WithdrawalRpc[];
  /** DATA, 32 Bytes - value for the parentBeaconBlockRoot to be used for building block */
  parentBeaconBlockRoot?: DATA;
};

export interface BlobsBundleRpc {
  commitments: DATA[]; // each 48 bytes
  blobs: DATA[]; // each 4096 * 32 = 131072 bytes
  proofs: DATA[]; // some ELs could also provide proofs, each 48 bytes
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

  // DENEB adds blobGasUsed & excessBlobGas to the ExecutionPayload
  if (ForkSeq[fork] >= ForkSeq.deneb) {
    const {blobGasUsed, excessBlobGas} = data as deneb.ExecutionPayload;
    payload.blobGasUsed = numToQuantity(blobGasUsed);
    payload.excessBlobGas = numToQuantity(excessBlobGas);
  }

  return payload;
}

export function serializeVersionedHashes(vHashes: VersionedHashes): VersionedHashesRpc {
  return vHashes.map(bytesToData);
}

export function hasPayloadValue(response: ExecutionPayloadResponse): response is ExecutionPayloadRpcWithValue {
  return (response as ExecutionPayloadRpcWithValue).blockValue !== undefined;
}

export function parseExecutionPayload(
  fork: ForkName,
  response: ExecutionPayloadResponse
): {executionPayload: allForks.ExecutionPayload; executionPayloadValue: Wei; blobsBundle?: BlobsBundle} {
  let data: ExecutionPayloadRpc;
  let executionPayloadValue: Wei;
  let blobsBundle: BlobsBundle | undefined;
  if (hasPayloadValue(response)) {
    executionPayloadValue = quantityToBigint(response.blockValue);
    data = response.executionPayload;
    blobsBundle = response.blobsBundle ? parseBlobsBundle(response.blobsBundle) : undefined;
  } else {
    data = response;
    // Just set it to zero as default
    executionPayloadValue = BigInt(0);
    blobsBundle = undefined;
  }

  const executionPayload = {
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
        `withdrawals missing for ${fork} >= capella executionPayload number=${executionPayload.blockNumber} hash=${data.blockHash}`
      );
    }
    (executionPayload as capella.ExecutionPayload).withdrawals = withdrawals.map((w) => deserializeWithdrawal(w));
  }

  // DENEB adds excessBlobGas to the ExecutionPayload
  if (ForkSeq[fork] >= ForkSeq.deneb) {
    const {blobGasUsed, excessBlobGas} = data;

    if (blobGasUsed == null) {
      throw Error(
        `blobGasUsed missing for ${fork} >= deneb executionPayload number=${executionPayload.blockNumber} hash=${data.blockHash}`
      );
    }
    if (excessBlobGas == null) {
      throw Error(
        `excessBlobGas missing for ${fork} >= deneb executionPayload number=${executionPayload.blockNumber} hash=${data.blockHash}`
      );
    }

    (executionPayload as deneb.ExecutionPayload).blobGasUsed = quantityToBigint(blobGasUsed);
    (executionPayload as deneb.ExecutionPayload).excessBlobGas = quantityToBigint(excessBlobGas);
  }

  return {executionPayload, executionPayloadValue, blobsBundle};
}

export function serializePayloadAttributes(data: PayloadAttributes): PayloadAttributesRpc {
  return {
    timestamp: numToQuantity(data.timestamp),
    prevRandao: bytesToData(data.prevRandao),
    suggestedFeeRecipient: data.suggestedFeeRecipient,
    withdrawals: data.withdrawals?.map(serializeWithdrawal),
    parentBeaconBlockRoot: data.parentBeaconBlockRoot ? bytesToData(data.parentBeaconBlockRoot) : undefined,
  };
}

export function serializeBeaconBlockRoot(data: Root): DATA {
  return bytesToData(data);
}

export function deserializePayloadAttributes(data: PayloadAttributesRpc): PayloadAttributes {
  return {
    timestamp: quantityToNum(data.timestamp),
    prevRandao: dataToBytes(data.prevRandao, 32),
    // DATA is anyway a hex string, so we can just track it as a hex string to
    // avoid any conversions
    suggestedFeeRecipient: data.suggestedFeeRecipient,
    withdrawals: data.withdrawals?.map((withdrawal) => deserializeWithdrawal(withdrawal)),
    parentBeaconBlockRoot: data.parentBeaconBlockRoot ? dataToBytes(data.parentBeaconBlockRoot, 32) : undefined,
  };
}

export function parseBlobsBundle(data: BlobsBundleRpc): BlobsBundle {
  return {
    // As of Nov 17th 2022 according to Dan's tests Geth returns null if no blobs in block
    commitments: (data.commitments ?? []).map((kzg) => dataToBytes(kzg, 48)),
    blobs: (data.blobs ?? []).map((blob) => dataToBytes(blob, BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB)),
    proofs: (data.proofs ?? []).map((kzg) => dataToBytes(kzg, 48)),
  };
}

export function serializeBlobsBundle(data: BlobsBundle): BlobsBundleRpc {
  return {
    commitments: data.commitments.map((kzg) => bytesToData(kzg)),
    blobs: data.blobs.map((blob) => bytesToData(blob)),
    proofs: data.blobs.map((proof) => bytesToData(proof)),
  };
}

export function serializeWithdrawal(withdrawal: capella.Withdrawal): WithdrawalRpc {
  return {
    index: numToQuantity(withdrawal.index),
    validatorIndex: numToQuantity(withdrawal.validatorIndex),
    address: bytesToData(withdrawal.address),
    // Both CL and EL now deal in Gwei, just little-endian to big-endian conversion required
    amount: numToQuantity(withdrawal.amount),
  };
}

export function deserializeWithdrawal(serialized: WithdrawalRpc): capella.Withdrawal {
  return {
    index: quantityToNum(serialized.index),
    validatorIndex: quantityToNum(serialized.validatorIndex),
    address: dataToBytes(serialized.address, 20),
    // Both CL and EL now deal in Gwei, just big-endian to little-endian conversion required
    amount: quantityToBigint(serialized.amount),
  } as capella.Withdrawal;
}

export function deserializeExecutionPayloadBody(data: ExecutionPayloadBodyRpc | null): ExecutionPayloadBody | null {
  return data
    ? {
        transactions: data.transactions.map((tran) => dataToBytes(tran, null)),
        withdrawals: data.withdrawals ? data.withdrawals.map(deserializeWithdrawal) : null,
      }
    : null;
}

export function serializeExecutionPayloadBody(data: ExecutionPayloadBody | null): ExecutionPayloadBodyRpc | null {
  return data
    ? {
        transactions: data.transactions.map((tran) => bytesToData(tran)),
        withdrawals: data.withdrawals ? data.withdrawals.map(serializeWithdrawal) : null,
      }
    : null;
}

export function assertReqSizeLimit(blockHashesReqCount: number, count: number): void {
  if (blockHashesReqCount > count) {
    throw new Error(`Requested blocks must not be > ${count}`);
  }
  return;
}
