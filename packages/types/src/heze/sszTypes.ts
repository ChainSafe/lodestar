import {BitVectorType, ContainerType, ProgressiveContainerType, VectorBasicType} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, ValidatorIndex} = primitiveSsz;

function activeFields(count: number, gaps: number[] = []): boolean[] {
  return Array.from({length: count}, (_, i) => !gaps.includes(i));
}

export const InclusionListCommittee = new VectorBasicType(ValidatorIndex, INCLUSION_LIST_COMMITTEE_SIZE);

export const InclusionListBits = new BitVectorType(INCLUSION_LIST_COMMITTEE_SIZE);

export const InclusionList = new ContainerType(
  {
    slot: Slot,
    validatorIndex: ValidatorIndex,
    dependentRoot: Root,
    transactions: gloasSsz.Transactions,
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

const {
  eth1Data: _eth1Data, // [Removed in Heze:EIP8015]
  eth1DataVotes: _eth1DataVotes, // [Removed in Heze:EIP8015]
  eth1DepositIndex: _eth1DepositIndex, // [Removed in Heze:EIP8015]
  depositRequestsStartIndex: _depositRequestsStartIndex, // [Removed in Heze:EIP8015]
  ...gloasBeaconStateFields
} = gloasSsz.BeaconState.fields;

export const BeaconState = new ProgressiveContainerType(
  {
    ...gloasBeaconStateFields,
    latestExecutionPayloadBid: ExecutionPayloadBid, // [Modified in Heze:EIP7805]
  },
  activeFields(46, [8, 9, 10, 28]), // [Modified in Heze:EIP8015]
  {typeName: "BeaconState", jsonCase: "eth2"}
);

const {
  eth1Data: _bodyEth1Data, // [Removed in Heze:EIP8015]
  deposits: _deposits, // [Removed in Heze:EIP8015]
  ...gloasBeaconBlockBodyFields
} = gloasSsz.BeaconBlockBody.fields;

export const BeaconBlockBody = new ProgressiveContainerType(
  {
    ...gloasBeaconBlockBodyFields,
    signedExecutionPayloadBid: SignedExecutionPayloadBid, // [Modified in Heze:EIP7805]
  },
  activeFields(13, [1, 6]), // [Modified in Heze:EIP8015]
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
    inclusionListTransactions: gloasSsz.Transactions, // [New in Heze:EIP7805]
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
