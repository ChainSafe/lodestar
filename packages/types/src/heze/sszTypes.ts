import {BitVectorType, ContainerType, ProgressiveContainerType, VectorBasicType} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, ValidatorIndex} = primitiveSsz;

function activeFields(count: number): boolean[] {
  return Array.from({length: count}, () => true);
}

export const InclusionListCommittee = new VectorBasicType(ValidatorIndex, INCLUSION_LIST_COMMITTEE_SIZE);

export const InclusionListBits = new BitVectorType(INCLUSION_LIST_COMMITTEE_SIZE);

export const InclusionListTransactions = gloasSsz.Transactions;

export const InclusionList = new ContainerType(
  {
    slot: Slot,
    validatorIndex: ValidatorIndex,
    dependentRoot: Root,
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

export const InclusionListsByIndicesRequest = new ContainerType(
  {
    slot: Slot,
    dependentRoot: Root,
    indices: InclusionListBits,
  },
  {typeName: "InclusionListsByIndicesRequest", jsonCase: "eth2"}
);

export const ExecutionPayloadBid = new ProgressiveContainerType(
  {
    ...gloasSsz.ExecutionPayloadBid.fields,
    inclusionListBits: InclusionListBits, // [New in Heze:EIP7805]
  },
  activeFields(13),
  {typeName: "ExecutionPayloadBid", jsonCase: "eth2"}
);

export const SignedExecutionPayloadBid = new ContainerType(
  {
    message: ExecutionPayloadBid, // [Modified in Heze:EIP7805]
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadBid", jsonCase: "eth2"}
);

export const DataColumnSidecar = gloasSsz.DataColumnSidecar;
export const DataColumnSidecars = gloasSsz.DataColumnSidecars;

export const BeaconState = new ProgressiveContainerType(
  {
    ...gloasSsz.BeaconState.fields,
    latestExecutionPayloadBid: ExecutionPayloadBid, // [Modified in Heze:EIP7805]
  },
  activeFields(46),
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ProgressiveContainerType(
  {
    ...gloasSsz.BeaconBlockBody.fields,
    signedExecutionPayloadBid: SignedExecutionPayloadBid, // [Modified in Heze:EIP7805]
  },
  activeFields(13),
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...gloasSsz.BeaconBlock.fields,
    body: BeaconBlockBody,
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

export const BlockContents = new ContainerType(
  {
    ...gloasSsz.BlockContents.fields,
    block: BeaconBlock,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event
export const PayloadAttributes = new ContainerType(
  {
    ...gloasSsz.PayloadAttributes.fields,
    inclusionListTransactions: InclusionListTransactions, // [New in Heze:EIP7805]
  },
  {typeName: "PayloadAttributes", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = new ContainerType(
  {
    ...gloasSsz.SSEPayloadAttributes.fields,
    payloadAttributes: PayloadAttributes, // [Modified in Heze:EIP7805]
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);
