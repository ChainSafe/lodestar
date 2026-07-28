import {
  BitVectorType,
  ContainerType,
  ProgressiveContainerType,
  ProgressiveListCompositeType,
  VectorBasicType,
} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, ValidatorIndex} = primitiveSsz;

function activeFields(count: number): boolean[] {
  return Array.from({length: count}, () => true);
}

export const InclusionListCommittee = new VectorBasicType(ValidatorIndex, INCLUSION_LIST_COMMITTEE_SIZE);

export const InclusionListTransactions = new ProgressiveListCompositeType(gloasSsz.Transaction, {
  typeName: "InclusionListTransactions",
});

// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/heze/beacon-chain.md#inclusionlist
export const InclusionList = new ContainerType(
  {
    slot: Slot,
    validatorIndex: ValidatorIndex,
    inclusionListCommitteeRoot: Root,
    transactions: InclusionListTransactions,
  },
  {typeName: "InclusionList", jsonCase: "eth2"}
);

// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/heze/beacon-chain.md#signedinclusionlist
export const SignedInclusionList = new ContainerType(
  {
    message: InclusionList,
    signature: BLSSignature,
  },
  {typeName: "SignedInclusionList", jsonCase: "eth2"}
);

// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/heze/p2p-interface.md#inclusionlistbycommitteeindices-v1
export const InclusionListByCommitteeIndicesRequest = new ContainerType(
  {
    slot: Slot,
    committeeIndices: new BitVectorType(INCLUSION_LIST_COMMITTEE_SIZE),
  },
  {typeName: "InclusionListByCommitteeIndicesRequest", jsonCase: "eth2"}
);

// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/heze/beacon-chain.md#executionpayloadbid
export const ExecutionPayloadBid = new ProgressiveContainerType(
  {
    ...gloasSsz.ExecutionPayloadBid.fields,
    inclusionListBits: new BitVectorType(INCLUSION_LIST_COMMITTEE_SIZE), // [New in Heze:EIP7805]
  },
  activeFields(13),
  {typeName: "ExecutionPayloadBid", jsonCase: "eth2"}
);

// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/heze/beacon-chain.md#signedexecutionpayloadbid
export const SignedExecutionPayloadBid = new ContainerType(
  {
    message: ExecutionPayloadBid, // [Modified in Heze:EIP7805]
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadBid", jsonCase: "eth2"}
);

export const DataColumnSidecar = gloasSsz.DataColumnSidecar;
export const DataColumnSidecars = gloasSsz.DataColumnSidecars;

// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/heze/beacon-chain.md#beaconstate
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
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/heze/fork-choice.md#modified-payloadattributes
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
