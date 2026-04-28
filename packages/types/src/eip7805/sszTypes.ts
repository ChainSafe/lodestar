import {BitVectorType, ContainerType, ListCompositeType, VectorBasicType} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE, MAX_TRANSACTIONS_PER_PAYLOAD} from "@lodestar/params";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as fuluSsz} from "../fulu/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, ValidatorIndex} = primitiveSsz;

export const InclusionListCommittee = new VectorBasicType(ValidatorIndex, INCLUSION_LIST_COMMITTEE_SIZE);
export const InclusionListTransactions = new ListCompositeType(
  bellatrixSsz.Transaction,
  MAX_TRANSACTIONS_PER_PAYLOAD * INCLUSION_LIST_COMMITTEE_SIZE
);

export const InclusionList = new ContainerType(
  {
    slot: Slot,
    validatorIndex: ValidatorIndex,
    inclusionListCommitteeRoot: Root,
    transactions: InclusionListTransactions,
  },
  {typeName: "InclusionList", jsonCase: "eth2"}
);

export const SignedInclusionList = new ContainerType(
  {
    message: InclusionList,
    signature: BLSSignature,
  },
  {typeName: "SignedInclusionList", jsonCase: "eth2"}
);

export const InclusionListByCommitteeIndicesRequest = new ContainerType(
  {
    slot: Slot,
    committeeIndices: new BitVectorType(INCLUSION_LIST_COMMITTEE_SIZE),
  },
  {typeName: "InclusionListByCommitteeIndicesRequest", jsonCase: "eth2"}
);

export const DataColumnSidecar = fuluSsz.DataColumnSidecar;
export const DataColumnSidecars = fuluSsz.DataColumnSidecars;

export const BeaconState = new ContainerType(
  {
    ...fuluSsz.BeaconState.fields,
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    ...electraSsz.BeaconBlockBody.fields,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...fuluSsz.BeaconBlock.fields,
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    ...fuluSsz.SignedBeaconBlock.fields,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...electraSsz.BlindedBeaconBlockBody.fields,
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...electraSsz.BlindedBeaconBlock.fields,
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    ...electraSsz.SignedBlindedBeaconBlock.fields,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const ExecutionPayload = new ContainerType(
  {
    ...electraSsz.ExecutionPayload.fields,
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...electraSsz.ExecutionPayloadHeader.fields,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event
export const PayloadAttributes = new ContainerType(
  {
    ...electraSsz.PayloadAttributes.fields,
    inclusionListTransactions: InclusionListTransactions,
  },
  {typeName: "PayloadAttributes", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = new ContainerType(
  {
    ...bellatrixSsz.SSEPayloadAttributesCommon.fields,
    payloadAttributes: PayloadAttributes,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);
