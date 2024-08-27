import {ContainerType, ByteVectorType, ListCompositeType, VectorCompositeType, ListBasicType} from "@chainsafe/ssz";
import {
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_CELL,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  NUMBER_OF_COLUMNS,
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  MAX_REQUEST_DATA_COLUMN_SIDECARS,
} from "@lodestar/params";

import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altariSsz} from "../altair/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

const {BLSSignature, Root, ColumnIndex, Bytes32, Slot, UintNum64, Uint8} = primitiveSsz;

export const Metadata = new ContainerType(
  {
    ...altariSsz.Metadata.fields,
    csc: Uint8,
  },
  {typeName: "Metadata", jsonCase: "eth2"}
);

export const Cell = new ByteVectorType(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_CELL);
export const DataColumn = new ListCompositeType(Cell, MAX_BLOB_COMMITMENTS_PER_BLOCK);
export const ExtendedMatrix = new ListCompositeType(Cell, MAX_BLOB_COMMITMENTS_PER_BLOCK * NUMBER_OF_COLUMNS);
export const KzgCommitmentsInclusionProof = new VectorCompositeType(Bytes32, KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH);

export const DataColumnSidecar = new ContainerType(
  {
    index: ColumnIndex,
    column: DataColumn,
    kzgCommitments: denebSsz.BlobKzgCommitments,
    kzgProofs: denebSsz.KZGProofs,
    signedBlockHeader: phase0Ssz.SignedBeaconBlockHeader,
    kzgCommitmentsInclusionProof: KzgCommitmentsInclusionProof,
  },
  {typeName: "DataColumnSidecar", jsonCase: "eth2"}
);

export const DataColumnSidecars = new ListCompositeType(DataColumnSidecar, NUMBER_OF_COLUMNS);

// ReqResp types
// =============

export const DataColumnIdentifier = new ContainerType(
  {
    blockRoot: Root,
    index: ColumnIndex,
  },
  {typeName: "DataColumnIdentifier", jsonCase: "eth2"}
);

export const DataColumnSidecarsByRootRequest = new ListCompositeType(
  DataColumnIdentifier,
  MAX_REQUEST_DATA_COLUMN_SIDECARS
);

export const DataColumnSidecarsByRangeRequest = new ContainerType(
  {
    startSlot: Slot,
    count: UintNum64,
    columns: new ListBasicType(ColumnIndex, NUMBER_OF_COLUMNS),
  },
  {typeName: "DataColumnSidecarsByRangeRequest", jsonCase: "eth2"}
);

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    ...denebSsz.BeaconBlockBody.fields,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...denebSsz.BeaconBlock.fields,
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlobSidecar = new ContainerType(
  {
    ...denebSsz.BlobSidecar.fields,
  },
  {typeName: "BlobSidecar", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...denebSsz.BlindedBeaconBlockBody.fields,
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...denebSsz.BlindedBeaconBlock.fields,
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const BuilderBid = new ContainerType(
  {
    ...denebSsz.BuilderBid.fields,
  },
  {typeName: "BuilderBid", jsonCase: "eth2"}
);

export const SignedBuilderBid = new ContainerType(
  {
    message: BuilderBid,
    signature: BLSSignature,
  },
  {typeName: "SignedBuilderBid", jsonCase: "eth2"}
);

export const ExecutionPayloadAndBlobsBundle = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadAndBlobsBundle.fields,
  },
  {typeName: "ExecutionPayloadAndBlobsBundle", jsonCase: "eth2"}
);

export const BeaconState = new ContainerType(
  {
    ...denebSsz.BeaconState.fields,
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    ...denebSsz.LightClientHeader.fields,
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    ...denebSsz.LightClientBootstrap.fields,
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    ...denebSsz.LightClientUpdate.fields,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    ...denebSsz.LightClientFinalityUpdate.fields,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = new ContainerType(
  {
    ...denebSsz.LightClientOptimisticUpdate.fields,
  },
  {typeName: "LightClientOptimisticUpdate", jsonCase: "eth2"}
);

export const LightClientStore = new ContainerType(
  {
    ...denebSsz.LightClientStore.fields,
  },
  {typeName: "LightClientStore", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = new ContainerType(
  {
    ...denebSsz.SSEPayloadAttributes.fields,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);

export const BlockContents = new ContainerType(
  {
    ...denebSsz.BlockContents.fields,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

export const SignedBlockContents = new ContainerType(
  {
    ...denebSsz.SignedBlockContents.fields,
  },
  {typeName: "SignedBlockContents", jsonCase: "eth2"}
);
