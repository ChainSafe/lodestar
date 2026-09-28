import {
  BitVectorType,
  ByteListType,
  CompositeType,
  CompositeView,
  CompositeViewDU,
  ContainerType,
  ListCompositeType,
  ValueOf,
} from "@chainsafe/ssz";
import {CELLS_PER_EXT_BLOB, ForkName, ForkPostBellatrix, MAX_BYTES_PER_TRANSACTION} from "@lodestar/params";
import {ssz} from "@lodestar/types";

/**
 * SSZ containers of the REST engine API, per execution-apis `src/engine/refactor-ssz.md`.
 *
 * Execution payloads, withdrawals and blobs bundles are shared with the consensus types since
 * they serialize identically. Everything else is transport-only and therefore defined here.
 */

const MAX_EXECUTION_REQUESTS_PER_PAYLOAD = 256;
const MAX_BYTES_PER_EXECUTION_REQUEST = MAX_BYTES_PER_TRANSACTION;
const MAX_BAL_BYTES = MAX_BYTES_PER_TRANSACTION;
const MAX_ERROR_BYTES = 1024;
export const MAX_BODIES_REQUEST = 32;
export const MAX_BLOBS_REQUEST = 128;

/** `Optional[T]` is `List[T, 1]` on the wire, the ssz library's `OptionalType` is a different encoding */
function Optional<T extends CompositeType<ValueOf<T>, CompositeView<T>, CompositeViewDU<T>>>(
  type: T
): ListCompositeType<T> {
  return new ListCompositeType(type, 1);
}

const {Bytes8, Bytes32, Bytes48, ExecutionAddress, Root, Uint8, UintBn64, UintBn256, UintNum64} = ssz;

const ExecutionRequestsList = new ListCompositeType(
  new ByteListType(MAX_BYTES_PER_EXECUTION_REQUEST),
  MAX_EXECUTION_REQUESTS_PER_PAYLOAD
);

export const PayloadStatus = new ContainerType(
  {
    status: Uint8,
    latestValidHash: Optional(Bytes32),
    validationError: Optional(new ByteListType(MAX_ERROR_BYTES)),
  },
  {typeName: "PayloadStatus"}
);

export const ForkchoiceState = new ContainerType(
  {
    headBlockHash: Bytes32,
    safeBlockHash: Bytes32,
    finalizedBlockHash: Bytes32,
  },
  {typeName: "ForkchoiceState"}
);

export const ForkchoiceUpdateResponse = new ContainerType(
  {
    payloadStatus: PayloadStatus,
    payloadId: Optional(Bytes8),
  },
  {typeName: "ForkchoiceUpdateResponse"}
);

export const PayloadAttributesBellatrix = new ContainerType(
  {
    timestamp: UintNum64,
    prevRandao: Bytes32,
    suggestedFeeRecipient: ExecutionAddress,
  },
  {typeName: "PayloadAttributes"}
);

export const PayloadAttributesCapella = new ContainerType(
  {
    ...PayloadAttributesBellatrix.fields,
    withdrawals: ssz.capella.Withdrawals,
  },
  {typeName: "PayloadAttributes"}
);

export const PayloadAttributesDeneb = new ContainerType(
  {
    ...PayloadAttributesCapella.fields,
    parentBeaconBlockRoot: Root,
  },
  {typeName: "PayloadAttributes"}
);

export const PayloadAttributesGloas = new ContainerType(
  {
    ...PayloadAttributesDeneb.fields,
    slotNumber: UintNum64,
    targetGasLimit: UintBn64,
  },
  {typeName: "PayloadAttributes"}
);

const CustodyColumns = new BitVectorType(CELLS_PER_EXT_BLOB);

function ForkchoiceUpdateType<T extends CompositeType<ValueOf<T>, CompositeView<T>, CompositeViewDU<T>>>(
  payloadAttributes: T
) {
  return new ContainerType(
    {
      forkchoiceState: ForkchoiceState,
      payloadAttributes: Optional(payloadAttributes),
    },
    {typeName: "ForkchoiceUpdate"}
  );
}

export const ForkchoiceUpdateBellatrix = ForkchoiceUpdateType(PayloadAttributesBellatrix);
export const ForkchoiceUpdateCapella = ForkchoiceUpdateType(PayloadAttributesCapella);
export const ForkchoiceUpdateDeneb = ForkchoiceUpdateType(PayloadAttributesDeneb);
export const ForkchoiceUpdateGloas = new ContainerType(
  {
    ...ForkchoiceUpdateType(PayloadAttributesGloas).fields,
    custodyColumns: Optional(CustodyColumns),
  },
  {typeName: "ForkchoiceUpdate"}
);

export const ExecutionPayloadEnvelopeBellatrix = new ContainerType(
  {payload: ssz.bellatrix.ExecutionPayload},
  {typeName: "ExecutionPayloadEnvelope"}
);
export const ExecutionPayloadEnvelopeCapella = new ContainerType(
  {payload: ssz.capella.ExecutionPayload},
  {typeName: "ExecutionPayloadEnvelope"}
);
export const ExecutionPayloadEnvelopeDeneb = new ContainerType(
  {
    payload: ssz.deneb.ExecutionPayload,
    parentBeaconBlockRoot: Root,
  },
  {typeName: "ExecutionPayloadEnvelope"}
);
export const ExecutionPayloadEnvelopeElectra = new ContainerType(
  {
    payload: ssz.electra.ExecutionPayload,
    parentBeaconBlockRoot: Root,
    executionRequests: ExecutionRequestsList,
  },
  {typeName: "ExecutionPayloadEnvelope"}
);
export const ExecutionPayloadEnvelopeGloas = new ContainerType(
  {
    payload: ssz.gloas.ExecutionPayload,
    parentBeaconBlockRoot: Root,
    executionRequests: ExecutionRequestsList,
  },
  {typeName: "ExecutionPayloadEnvelope"}
);

export const BuiltPayloadBellatrix = new ContainerType(
  {
    payload: ssz.bellatrix.ExecutionPayload,
    blockValue: UintBn256,
  },
  {typeName: "BuiltPayload"}
);
export const BuiltPayloadCapella = new ContainerType(
  {
    payload: ssz.capella.ExecutionPayload,
    blockValue: UintBn256,
  },
  {typeName: "BuiltPayload"}
);
export const BuiltPayloadDeneb = new ContainerType(
  {
    payload: ssz.deneb.ExecutionPayload,
    blockValue: UintBn256,
    blobsBundle: ssz.deneb.BlobsBundle,
    shouldOverrideBuilder: ssz.Boolean,
  },
  {typeName: "BuiltPayload"}
);
export const BuiltPayloadElectra = new ContainerType(
  {
    payload: ssz.electra.ExecutionPayload,
    blockValue: UintBn256,
    blobsBundle: ssz.deneb.BlobsBundle,
    executionRequests: ExecutionRequestsList,
    shouldOverrideBuilder: ssz.Boolean,
  },
  {typeName: "BuiltPayload"}
);
export const BuiltPayloadFulu = new ContainerType(
  {
    payload: ssz.fulu.ExecutionPayload,
    blockValue: UintBn256,
    blobsBundle: ssz.fulu.BlobsBundle,
    executionRequests: ExecutionRequestsList,
    shouldOverrideBuilder: ssz.Boolean,
  },
  {typeName: "BuiltPayload"}
);
export const BuiltPayloadGloas = new ContainerType(
  {
    payload: ssz.gloas.ExecutionPayload,
    blockValue: UintBn256,
    blobsBundle: ssz.fulu.BlobsBundle,
    executionRequests: ExecutionRequestsList,
    shouldOverrideBuilder: ssz.Boolean,
  },
  {typeName: "BuiltPayload"}
);

export const ExecutionPayloadBodyBellatrix = new ContainerType(
  {transactions: ssz.bellatrix.Transactions},
  {typeName: "ExecutionPayloadBody"}
);
export const ExecutionPayloadBodyCapella = new ContainerType(
  {
    transactions: ssz.bellatrix.Transactions,
    withdrawals: ssz.capella.Withdrawals,
  },
  {typeName: "ExecutionPayloadBody"}
);
export const ExecutionPayloadBodyGloas = new ContainerType(
  {
    transactions: ssz.bellatrix.Transactions,
    withdrawals: ssz.capella.Withdrawals,
    blockAccessList: new ByteListType(MAX_BAL_BYTES),
  },
  {typeName: "ExecutionPayloadBody"}
);

function BodiesResponseType<T extends CompositeType<ValueOf<T>, CompositeView<T>, CompositeViewDU<T>>>(body: T) {
  const BodyEntry = new ContainerType({available: ssz.Boolean, body}, {typeName: "BodyEntry"});
  return new ContainerType(
    {entries: new ListCompositeType(BodyEntry, MAX_BODIES_REQUEST)},
    {typeName: "BodiesResponse"}
  );
}

export const BodiesResponseBellatrix = BodiesResponseType(ExecutionPayloadBodyBellatrix);
export const BodiesResponseCapella = BodiesResponseType(ExecutionPayloadBodyCapella);
export const BodiesResponseGloas = BodiesResponseType(ExecutionPayloadBodyGloas);

export const BodiesByHashRequest = new ContainerType(
  {blockHashes: new ListCompositeType(Bytes32, MAX_BODIES_REQUEST)},
  {typeName: "BodiesByHashRequest"}
);

export const BlobsRequest = new ContainerType(
  {versionedHashes: new ListCompositeType(Bytes32, MAX_BLOBS_REQUEST)},
  {typeName: "BlobsRequest"}
);

const BlobAndProofV1 = new ContainerType(
  {
    blob: ssz.deneb.Blob,
    proof: Bytes48,
  },
  {typeName: "BlobAndProofV1"}
);

const BlobAndProofV2 = new ContainerType(
  {
    blob: ssz.deneb.Blob,
    proofs: new ListCompositeType(Bytes48, CELLS_PER_EXT_BLOB),
  },
  {typeName: "BlobAndProofV2"}
);

function BlobsResponseType<T extends CompositeType<ValueOf<T>, CompositeView<T>, CompositeViewDU<T>>>(contents: T) {
  const BlobEntry = new ContainerType({available: ssz.Boolean, contents}, {typeName: "BlobEntry"});
  return new ContainerType({entries: new ListCompositeType(BlobEntry, MAX_BLOBS_REQUEST)}, {typeName: "BlobsResponse"});
}

export const BlobsV1Response = BlobsResponseType(BlobAndProofV1);
export const BlobsV2Response = BlobsResponseType(BlobAndProofV2);

const bellatrix = {
  PayloadAttributes: PayloadAttributesBellatrix,
  ForkchoiceUpdate: ForkchoiceUpdateBellatrix,
  ExecutionPayloadEnvelope: ExecutionPayloadEnvelopeBellatrix,
  BuiltPayload: BuiltPayloadBellatrix,
  BodiesResponse: BodiesResponseBellatrix,
};

const capella = {
  PayloadAttributes: PayloadAttributesCapella,
  ForkchoiceUpdate: ForkchoiceUpdateCapella,
  ExecutionPayloadEnvelope: ExecutionPayloadEnvelopeCapella,
  BuiltPayload: BuiltPayloadCapella,
  BodiesResponse: BodiesResponseCapella,
};

const deneb = {
  PayloadAttributes: PayloadAttributesDeneb,
  ForkchoiceUpdate: ForkchoiceUpdateDeneb,
  ExecutionPayloadEnvelope: ExecutionPayloadEnvelopeDeneb,
  BuiltPayload: BuiltPayloadDeneb,
  BodiesResponse: BodiesResponseCapella,
};

const electra = {
  ...deneb,
  ExecutionPayloadEnvelope: ExecutionPayloadEnvelopeElectra,
  BuiltPayload: BuiltPayloadElectra,
};

const fulu = {
  ...electra,
  BuiltPayload: BuiltPayloadFulu,
};

const gloas = {
  PayloadAttributes: PayloadAttributesGloas,
  ForkchoiceUpdate: ForkchoiceUpdateGloas,
  ExecutionPayloadEnvelope: ExecutionPayloadEnvelopeGloas,
  BuiltPayload: BuiltPayloadGloas,
  BodiesResponse: BodiesResponseGloas,
};

export const engineSszTypes = {
  [ForkName.bellatrix]: bellatrix,
  [ForkName.capella]: capella,
  [ForkName.deneb]: deneb,
  [ForkName.electra]: electra,
  [ForkName.fulu]: fulu,
  [ForkName.gloas]: gloas,
  [ForkName.heze]: gloas,
};

export type PayloadStatusSsz = ValueOf<typeof PayloadStatus>;

/** Fork names accepted in the `Eth-Execution-Version` header */
export type ExecutionForkName = "paris" | "shanghai" | "cancun" | "prague" | "osaka" | "amsterdam";

/** Heze has no execution fork name in the spec yet, calls for it stay on JSON-RPC */
export const executionForkName: Record<ForkPostBellatrix, ExecutionForkName | null> = {
  [ForkName.bellatrix]: "paris",
  [ForkName.capella]: "shanghai",
  [ForkName.deneb]: "cancun",
  [ForkName.electra]: "prague",
  [ForkName.fulu]: "osaka",
  [ForkName.gloas]: "amsterdam",
  [ForkName.heze]: null,
};

export enum PayloadStatusCode {
  VALID = 0,
  INVALID = 1,
  SYNCING = 2,
  ACCEPTED = 3,
}
