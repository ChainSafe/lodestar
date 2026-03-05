import {ByteListType, ByteVectorType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {
  BYTES_PER_FIELD_ELEMENT,
  CELLS_PER_EXT_BLOB,
  FIELD_ELEMENTS_PER_BLOB,
  ForkName,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  MAX_BYTES_PER_TRANSACTION,
  MAX_TRANSACTIONS_PER_PAYLOAD,
  MAX_WITHDRAWALS_PER_PAYLOAD,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ExecutionPayloadStatus} from "./interface.js";
import {
  type EngineApiRpcParamTypes,
  type EngineApiRpcReturnTypes,
  deserializeWithdrawal,
  serializeBlobsBundle,
  serializeExecutionPayload,
  serializeExecutionPayloadBody,
} from "./types.js";
import {bytesToData, dataToBytes, numToQuantity, quantityToNum} from "./utils.js";

const MAX_PAYLOAD_BODIES_REQUEST = 32;
const MAX_BLOB_HASHES_REQUEST = 128;
const MAX_EXECUTION_REQUESTS = 256;
const MAX_ERROR_MESSAGE_LENGTH = 1024;
const MAX_CLIENT_CODE_LENGTH = 2;
const MAX_CLIENT_NAME_LENGTH = 64;
const MAX_CLIENT_VERSION_LENGTH = 64;
const MAX_CLIENT_VERSIONS = 4;

const transactionByteListType = new ByteListType(MAX_BYTES_PER_TRANSACTION);
const transactionsType = new ListCompositeType(transactionByteListType, MAX_TRANSACTIONS_PER_PAYLOAD);

const executionPayloadBodyV1Type = new ContainerType(
  {
    transactions: transactionsType,
    withdrawals: new ListCompositeType(ssz.capella.Withdrawal, MAX_WITHDRAWALS_PER_PAYLOAD),
  },
  {typeName: "EngineExecutionPayloadBodyV1"}
);

const nullableExecutionPayloadBodyV1Type = new ListCompositeType(executionPayloadBodyV1Type, 1);

const payloadBodiesV1ResponseType = new ContainerType(
  {
    payloadBodies: new ListCompositeType(nullableExecutionPayloadBodyV1Type, MAX_PAYLOAD_BODIES_REQUEST),
  },
  {typeName: "EnginePayloadBodiesV1Response"}
);

const getPayloadBodiesByHashV1RequestType = new ContainerType(
  {
    blockHashes: new ListCompositeType(ssz.Bytes32, MAX_PAYLOAD_BODIES_REQUEST),
  },
  {typeName: "EngineGetPayloadBodiesByHashV1Request"}
);

const getPayloadBodiesByRangeV1RequestType = new ContainerType(
  {
    start: ssz.UintNum64,
    count: ssz.UintNum64,
  },
  {typeName: "EngineGetPayloadBodiesByRangeV1Request"}
);

const getBlobsV1RequestType = new ContainerType(
  {
    blobVersionedHashes: new ListCompositeType(ssz.Bytes32, MAX_BLOB_HASHES_REQUEST),
  },
  {typeName: "EngineGetBlobsV1Request"}
);

const getBlobsV2RequestType = new ContainerType(
  {
    blobVersionedHashes: new ListCompositeType(ssz.Bytes32, MAX_BLOB_HASHES_REQUEST),
  },
  {typeName: "EngineGetBlobsV2Request"}
);

const blobType = new ByteVectorType(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB);

const blobAndProofV1Type = new ContainerType(
  {
    blob: blobType,
    proof: ssz.Bytes48,
  },
  {typeName: "EngineBlobAndProofV1"}
);

const blobAndProofV2Type = new ContainerType(
  {
    blob: blobType,
    proofs: new ListCompositeType(ssz.Bytes48, CELLS_PER_EXT_BLOB),
  },
  {typeName: "EngineBlobAndProofV2"}
);

const getBlobsV1ResponseType = new ContainerType(
  {
    blobsAndProofs: new ListCompositeType(blobAndProofV1Type, MAX_BLOB_HASHES_REQUEST),
  },
  {typeName: "EngineGetBlobsV1Response"}
);

const getBlobsV2ResponseType = new ContainerType(
  {
    blobsAndProofs: new ListCompositeType(blobAndProofV2Type, MAX_BLOB_HASHES_REQUEST),
  },
  {typeName: "EngineGetBlobsV2Response"}
);

const payloadStatusV1Type = new ContainerType(
  {
    status: ssz.Uint8,
    latestValidHash: ssz.Bytes32,
    validationError: new ByteListType(MAX_ERROR_MESSAGE_LENGTH),
  },
  {typeName: "EnginePayloadStatusV1"}
);

const forkchoiceStateV1Type = new ContainerType(
  {
    headBlockHash: ssz.Bytes32,
    safeBlockHash: ssz.Bytes32,
    finalizedBlockHash: ssz.Bytes32,
  },
  {typeName: "EngineForkchoiceStateV1"}
);

const payloadAttributesV1Type = new ContainerType(
  {
    timestamp: ssz.UintNum64,
    prevRandao: ssz.Bytes32,
    suggestedFeeRecipient: ssz.Bytes20,
  },
  {typeName: "EnginePayloadAttributesV1"}
);

const payloadAttributesV2Type = new ContainerType(
  {
    timestamp: ssz.UintNum64,
    prevRandao: ssz.Bytes32,
    suggestedFeeRecipient: ssz.Bytes20,
    withdrawals: new ListCompositeType(ssz.capella.Withdrawal, MAX_WITHDRAWALS_PER_PAYLOAD),
  },
  {typeName: "EnginePayloadAttributesV2"}
);

const payloadAttributesV3Type = new ContainerType(
  {
    timestamp: ssz.UintNum64,
    prevRandao: ssz.Bytes32,
    suggestedFeeRecipient: ssz.Bytes20,
    withdrawals: new ListCompositeType(ssz.capella.Withdrawal, MAX_WITHDRAWALS_PER_PAYLOAD),
    parentBeaconBlockRoot: ssz.Bytes32,
  },
  {typeName: "EnginePayloadAttributesV3"}
);

const forkchoiceUpdatedV1RequestType = new ContainerType(
  {
    forkchoiceState: forkchoiceStateV1Type,
    payloadAttributes: new ListCompositeType(payloadAttributesV1Type, 1),
  },
  {typeName: "EngineForkchoiceUpdatedV1Request"}
);

const forkchoiceUpdatedV2RequestType = new ContainerType(
  {
    forkchoiceState: forkchoiceStateV1Type,
    payloadAttributes: new ListCompositeType(payloadAttributesV2Type, 1),
  },
  {typeName: "EngineForkchoiceUpdatedV2Request"}
);

const forkchoiceUpdatedV3RequestType = new ContainerType(
  {
    forkchoiceState: forkchoiceStateV1Type,
    payloadAttributes: new ListCompositeType(payloadAttributesV3Type, 1),
  },
  {typeName: "EngineForkchoiceUpdatedV3Request"}
);

const forkchoiceUpdatedResponseV1Type = new ContainerType(
  {
    payloadStatus: payloadStatusV1Type,
    payloadId: ssz.Bytes8,
  },
  {typeName: "EngineForkchoiceUpdatedResponseV1"}
);

const newPayloadV1RequestType = new ContainerType(
  {
    executionPayload: ssz.bellatrix.ExecutionPayload,
  },
  {typeName: "EngineNewPayloadV1Request"}
);

const newPayloadV2RequestType = new ContainerType(
  {
    executionPayload: ssz.capella.ExecutionPayload,
  },
  {typeName: "EngineNewPayloadV2Request"}
);

const newPayloadV3RequestType = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    expectedBlobVersionedHashes: new ListCompositeType(ssz.Bytes32, MAX_BLOB_COMMITMENTS_PER_BLOCK),
    parentBeaconBlockRoot: ssz.Bytes32,
  },
  {typeName: "EngineNewPayloadV3Request"}
);

const newPayloadV4RequestType = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    expectedBlobVersionedHashes: new ListCompositeType(ssz.Bytes32, MAX_BLOB_COMMITMENTS_PER_BLOCK),
    parentBeaconBlockRoot: ssz.Bytes32,
    executionRequests: new ListCompositeType(transactionByteListType, MAX_EXECUTION_REQUESTS),
  },
  {typeName: "EngineNewPayloadV4Request"}
);

const getPayloadResponseV2Type = new ContainerType(
  {
    executionPayload: ssz.capella.ExecutionPayload,
    blockValue: ssz.UintBn256,
  },
  {typeName: "EngineGetPayloadResponseV2"}
);

const getPayloadResponseV3Type = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    blockValue: ssz.UintBn256,
    blobsBundle: ssz.deneb.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
  },
  {typeName: "EngineGetPayloadResponseV3"}
);

const getPayloadResponseV4Type = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    blockValue: ssz.UintBn256,
    blobsBundle: ssz.deneb.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
    executionRequests: new ListCompositeType(transactionByteListType, MAX_EXECUTION_REQUESTS),
  },
  {typeName: "EngineGetPayloadResponseV4"}
);

const getPayloadResponseV5Type = new ContainerType(
  {
    executionPayload: ssz.deneb.ExecutionPayload,
    blockValue: ssz.UintBn256,
    blobsBundle: ssz.fulu.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
    executionRequests: new ListCompositeType(transactionByteListType, MAX_EXECUTION_REQUESTS),
  },
  {typeName: "EngineGetPayloadResponseV5"}
);

const clientVersionV1Type = new ContainerType(
  {
    code: new ByteListType(MAX_CLIENT_CODE_LENGTH),
    name: new ByteListType(MAX_CLIENT_NAME_LENGTH),
    version: new ByteListType(MAX_CLIENT_VERSION_LENGTH),
    commit: new ByteVectorType(4),
  },
  {typeName: "EngineClientVersionV1"}
);

const getClientVersionV1RequestType = new ContainerType(
  {
    clientVersion: clientVersionV1Type,
  },
  {typeName: "EngineGetClientVersionV1Request"}
);

const getClientVersionV1ResponseType = new ContainerType(
  {
    versions: new ListCompositeType(clientVersionV1Type, MAX_CLIENT_VERSIONS),
  },
  {typeName: "EngineGetClientVersionV1Response"}
);

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const payloadStatusByCode: Record<number, ExecutionPayloadStatus> = {
  0: ExecutionPayloadStatus.VALID,
  1: ExecutionPayloadStatus.INVALID,
  2: ExecutionPayloadStatus.SYNCING,
  3: ExecutionPayloadStatus.ACCEPTED,
  4: ExecutionPayloadStatus.INVALID_BLOCK_HASH,
};

const zeroRootHex = bytesToData(new Uint8Array(32));
const zeroPayloadIdHex = bytesToData(new Uint8Array(8));

function parsePayloadStatusFromSsz(value: {status: number; latestValidHash: Uint8Array; validationError: Uint8Array}): {
  status: ExecutionPayloadStatus;
  latestValidHash: string | null;
  validationError: string | null;
} {
  return {
    status: payloadStatusByCode[value.status] ?? ExecutionPayloadStatus.ELERROR,
    latestValidHash: bytesToData(value.latestValidHash) === zeroRootHex ? null : bytesToData(value.latestValidHash),
    validationError: value.validationError.length === 0 ? null : textDecoder.decode(value.validationError),
  };
}

export function encodeEngineSszRequest(
  method: keyof EngineApiRpcParamTypes,
  params: unknown[]
): Uint8Array | undefined {
  switch (method) {
    case "engine_newPayloadV1": {
      const [executionPayload] = params as EngineApiRpcParamTypes["engine_newPayloadV1"];
      return newPayloadV1RequestType.serialize({
        executionPayload: ssz.bellatrix.ExecutionPayload.fromJson(executionPayload),
      });
    }

    case "engine_newPayloadV2": {
      const [executionPayload] = params as EngineApiRpcParamTypes["engine_newPayloadV2"];
      return newPayloadV2RequestType.serialize({
        executionPayload: ssz.capella.ExecutionPayload.fromJson(executionPayload),
      });
    }

    case "engine_newPayloadV3": {
      const [executionPayload, expectedBlobVersionedHashes, parentBeaconBlockRoot] =
        params as EngineApiRpcParamTypes["engine_newPayloadV3"];
      return newPayloadV3RequestType.serialize({
        executionPayload: ssz.deneb.ExecutionPayload.fromJson(executionPayload),
        expectedBlobVersionedHashes: expectedBlobVersionedHashes.map((hash) => dataToBytes(hash, 32)),
        parentBeaconBlockRoot: dataToBytes(parentBeaconBlockRoot, 32),
      });
    }

    case "engine_newPayloadV4": {
      const [executionPayload, expectedBlobVersionedHashes, parentBeaconBlockRoot, executionRequests] =
        params as EngineApiRpcParamTypes["engine_newPayloadV4"];
      return newPayloadV4RequestType.serialize({
        executionPayload: ssz.deneb.ExecutionPayload.fromJson(executionPayload),
        expectedBlobVersionedHashes: expectedBlobVersionedHashes.map((hash) => dataToBytes(hash, 32)),
        parentBeaconBlockRoot: dataToBytes(parentBeaconBlockRoot, 32),
        executionRequests: executionRequests.map((request) => dataToBytes(request, null)),
      });
    }

    case "engine_forkchoiceUpdatedV1": {
      const [forkchoiceState, payloadAttributes] = params as EngineApiRpcParamTypes["engine_forkchoiceUpdatedV1"];
      return forkchoiceUpdatedV1RequestType.serialize({
        forkchoiceState: {
          headBlockHash: dataToBytes(forkchoiceState.headBlockHash, 32),
          safeBlockHash: dataToBytes(forkchoiceState.safeBlockHash, 32),
          finalizedBlockHash: dataToBytes(forkchoiceState.finalizedBlockHash, 32),
        },
        payloadAttributes:
          payloadAttributes === undefined
            ? []
            : [
                {
                  timestamp: quantityToNum(payloadAttributes.timestamp),
                  prevRandao: dataToBytes(payloadAttributes.prevRandao, 32),
                  suggestedFeeRecipient: dataToBytes(payloadAttributes.suggestedFeeRecipient, 20),
                },
              ],
      });
    }

    case "engine_forkchoiceUpdatedV2": {
      const [forkchoiceState, payloadAttributes] = params as EngineApiRpcParamTypes["engine_forkchoiceUpdatedV2"];
      return forkchoiceUpdatedV2RequestType.serialize({
        forkchoiceState: {
          headBlockHash: dataToBytes(forkchoiceState.headBlockHash, 32),
          safeBlockHash: dataToBytes(forkchoiceState.safeBlockHash, 32),
          finalizedBlockHash: dataToBytes(forkchoiceState.finalizedBlockHash, 32),
        },
        payloadAttributes:
          payloadAttributes === undefined
            ? []
            : [
                {
                  timestamp: quantityToNum(payloadAttributes.timestamp),
                  prevRandao: dataToBytes(payloadAttributes.prevRandao, 32),
                  suggestedFeeRecipient: dataToBytes(payloadAttributes.suggestedFeeRecipient, 20),
                  withdrawals: (payloadAttributes.withdrawals ?? []).map(deserializeWithdrawal),
                },
              ],
      });
    }

    case "engine_forkchoiceUpdatedV3": {
      const [forkchoiceState, payloadAttributes] = params as EngineApiRpcParamTypes["engine_forkchoiceUpdatedV3"];
      return forkchoiceUpdatedV3RequestType.serialize({
        forkchoiceState: {
          headBlockHash: dataToBytes(forkchoiceState.headBlockHash, 32),
          safeBlockHash: dataToBytes(forkchoiceState.safeBlockHash, 32),
          finalizedBlockHash: dataToBytes(forkchoiceState.finalizedBlockHash, 32),
        },
        payloadAttributes:
          payloadAttributes === undefined
            ? []
            : [
                {
                  timestamp: quantityToNum(payloadAttributes.timestamp),
                  prevRandao: dataToBytes(payloadAttributes.prevRandao, 32),
                  suggestedFeeRecipient: dataToBytes(payloadAttributes.suggestedFeeRecipient, 20),
                  withdrawals: (payloadAttributes.withdrawals ?? []).map(deserializeWithdrawal),
                  parentBeaconBlockRoot: dataToBytes(payloadAttributes.parentBeaconBlockRoot ?? zeroRootHex, 32),
                },
              ],
      });
    }

    case "engine_getPayloadBodiesByHashV1": {
      const [blockHashes] = params as EngineApiRpcParamTypes["engine_getPayloadBodiesByHashV1"];
      return getPayloadBodiesByHashV1RequestType.serialize({
        blockHashes: blockHashes.map((hash) => dataToBytes(hash, 32)),
      });
    }

    case "engine_getPayloadBodiesByRangeV1": {
      const [start, count] = params as EngineApiRpcParamTypes["engine_getPayloadBodiesByRangeV1"];
      return getPayloadBodiesByRangeV1RequestType.serialize({start: quantityToNum(start), count: quantityToNum(count)});
    }

    case "engine_getBlobsV1": {
      const [blobVersionedHashes] = params as EngineApiRpcParamTypes["engine_getBlobsV1"];
      return getBlobsV1RequestType.serialize({
        blobVersionedHashes: blobVersionedHashes.map((hash) => dataToBytes(hash, 32)),
      });
    }

    case "engine_getBlobsV2": {
      const [blobVersionedHashes] = params as EngineApiRpcParamTypes["engine_getBlobsV2"];
      return getBlobsV2RequestType.serialize({
        blobVersionedHashes: blobVersionedHashes.map((hash) => dataToBytes(hash, 32)),
      });
    }

    case "engine_getClientVersionV1": {
      const [clientVersion] = params as EngineApiRpcParamTypes["engine_getClientVersionV1"];
      return getClientVersionV1RequestType.serialize({
        clientVersion: {
          code: textEncoder.encode(clientVersion.code),
          name: textEncoder.encode(clientVersion.name),
          version: textEncoder.encode(clientVersion.version),
          commit: dataToBytes(clientVersion.commit, 4),
        },
      });
    }

    default:
      return undefined;
  }
}

export function decodeEngineSszResponse<M extends keyof EngineApiRpcReturnTypes>(
  method: M,
  status: number,
  bytes: Uint8Array
): EngineApiRpcReturnTypes[M] {
  if (status === 204) {
    if (method === "engine_getBlobsV2") {
      return null as EngineApiRpcReturnTypes[M];
    }

    throw Error(`Unexpected 204 status for ${method}`);
  }

  switch (method) {
    case "engine_newPayloadV1":
    case "engine_newPayloadV2":
    case "engine_newPayloadV3":
    case "engine_newPayloadV4": {
      return parsePayloadStatusFromSsz(payloadStatusV1Type.deserialize(bytes)) as EngineApiRpcReturnTypes[M];
    }

    case "engine_forkchoiceUpdatedV1":
    case "engine_forkchoiceUpdatedV2":
    case "engine_forkchoiceUpdatedV3": {
      const response = forkchoiceUpdatedResponseV1Type.deserialize(bytes);
      return {
        payloadStatus: parsePayloadStatusFromSsz(response.payloadStatus),
        payloadId: bytesToData(response.payloadId) === zeroPayloadIdHex ? null : bytesToData(response.payloadId),
      } as EngineApiRpcReturnTypes[M];
    }

    case "engine_getPayloadV1": {
      const executionPayload = ssz.bellatrix.ExecutionPayload.deserialize(bytes);
      return serializeExecutionPayload(ForkName.bellatrix, executionPayload) as EngineApiRpcReturnTypes[M];
    }

    case "engine_getPayloadV2": {
      const response = getPayloadResponseV2Type.deserialize(bytes);
      return {
        executionPayload: serializeExecutionPayload(ForkName.capella, response.executionPayload),
        blockValue: numToQuantity(response.blockValue),
      } as EngineApiRpcReturnTypes[M];
    }

    case "engine_getPayloadV3": {
      const response = getPayloadResponseV3Type.deserialize(bytes);
      return {
        executionPayload: serializeExecutionPayload(ForkName.deneb, response.executionPayload),
        blockValue: numToQuantity(response.blockValue),
        blobsBundle: serializeBlobsBundle(response.blobsBundle),
        shouldOverrideBuilder: response.shouldOverrideBuilder,
      } as EngineApiRpcReturnTypes[M];
    }

    case "engine_getPayloadV4": {
      const response = getPayloadResponseV4Type.deserialize(bytes);
      return {
        executionPayload: serializeExecutionPayload(ForkName.deneb, response.executionPayload),
        blockValue: numToQuantity(response.blockValue),
        blobsBundle: serializeBlobsBundle(response.blobsBundle),
        shouldOverrideBuilder: response.shouldOverrideBuilder,
        executionRequests: response.executionRequests.map((request) => bytesToData(request)),
      } as EngineApiRpcReturnTypes[M];
    }

    case "engine_getPayloadV5": {
      const response = getPayloadResponseV5Type.deserialize(bytes);
      return {
        executionPayload: serializeExecutionPayload(ForkName.deneb, response.executionPayload),
        blockValue: numToQuantity(response.blockValue),
        blobsBundle: serializeBlobsBundle(response.blobsBundle),
        shouldOverrideBuilder: response.shouldOverrideBuilder,
        executionRequests: response.executionRequests.map((request) => bytesToData(request)),
      } as EngineApiRpcReturnTypes[M];
    }

    case "engine_getPayloadBodiesByHashV1":
    case "engine_getPayloadBodiesByRangeV1": {
      const response = payloadBodiesV1ResponseType.deserialize(bytes);
      return response.payloadBodies.map((nullableBody) => {
        if (nullableBody.length === 0) return null;
        const body = nullableBody[0];
        return serializeExecutionPayloadBody({
          transactions: body.transactions,
          withdrawals: body.withdrawals,
        });
      }) as EngineApiRpcReturnTypes[M];
    }

    case "engine_getBlobsV1": {
      const response = getBlobsV1ResponseType.deserialize(bytes);
      return response.blobsAndProofs.map((blobAndProof) => ({
        blob: bytesToData(blobAndProof.blob),
        proof: bytesToData(blobAndProof.proof),
      })) as EngineApiRpcReturnTypes[M];
    }

    case "engine_getBlobsV2": {
      const response = getBlobsV2ResponseType.deserialize(bytes);
      return response.blobsAndProofs.map((blobAndProof) => ({
        blob: bytesToData(blobAndProof.blob),
        proofs: blobAndProof.proofs.map((proof) => bytesToData(proof)),
      })) as EngineApiRpcReturnTypes[M];
    }

    case "engine_getClientVersionV1": {
      const response = getClientVersionV1ResponseType.deserialize(bytes);
      return response.versions.map((version) => ({
        code: textDecoder.decode(version.code),
        name: textDecoder.decode(version.name),
        version: textDecoder.decode(version.version),
        commit: bytesToData(version.commit),
      })) as EngineApiRpcReturnTypes[M];
    }

    default:
      throw Error(`Unsupported SSZ response decoder for ${method}`);
  }
}
