import {
  BitVectorType,
  ContainerType,
  ProgressiveContainerType,
  ProgressiveListCompositeType,
  VectorBasicType,
} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE, MAX_SET_SWEEP_THRESHOLD_REQUESTS_PER_PAYLOAD} from "@lodestar/params";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, BLSPubkey, ValidatorIndex, ExecutionAddress, Gwei} = primitiveSsz;

function activeFields(count: number, gaps: number[] = []): boolean[] {
  return Array.from({length: count}, (_, index) => !gaps.includes(index));
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

// New in Heze:EIP8148
export const SetSweepThresholdRequest = new ContainerType(
  {
    sourceAddress: ExecutionAddress,
    validatorPubkey: BLSPubkey,
    threshold: Gwei,
  },
  {typeName: "SetSweepThresholdRequest", jsonCase: "eth2"}
);
export const SweepThresholdRequests = new ProgressiveListCompositeType(SetSweepThresholdRequest, {
  typeName: "SweepThresholdRequests",
  limit: MAX_SET_SWEEP_THRESHOLD_REQUESTS_PER_PAYLOAD,
});

export const ExecutionRequests = new ProgressiveContainerType(
  {
    ...gloasSsz.ExecutionRequests.fields,
    sweepThresholds: SweepThresholdRequests, // [New in Heze:EIP8148]
  },
  activeFields(6),
  {typeName: "ExecutionRequests", jsonCase: "eth2"}
);

export const NewPayloadRequest = new ProgressiveContainerType(
  {
    ...gloasSsz.NewPayloadRequest.fields,
    executionRequests: ExecutionRequests, // [Modified in Heze:EIP8148]
  },
  activeFields(4),
  {typeName: "NewPayloadRequest", jsonCase: "eth2"}
);

export const ExecutionPayloadEnvelope = new ProgressiveContainerType(
  {
    ...gloasSsz.ExecutionPayloadEnvelope.fields,
    executionRequests: ExecutionRequests, // [Modified in Heze:EIP8148]
  },
  activeFields(5),
  {typeName: "ExecutionPayloadEnvelope", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedExecutionPayloadEnvelope = new ContainerType(
  {
    message: ExecutionPayloadEnvelope,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadEnvelope", jsonCase: "eth2"}
);

/** Same field positions as ExecutionPayloadEnvelope, so it hashes to the same root */
export const ExecutionPayloadHeaderEnvelope = new ProgressiveContainerType(
  {
    ...gloasSsz.ExecutionPayloadHeaderEnvelope.fields,
    executionRequests: ExecutionRequests, // [Modified in Heze:EIP8148]
  },
  activeFields(5),
  {typeName: "ExecutionPayloadHeaderEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadHeaderEnvelope = new ContainerType(
  {
    message: ExecutionPayloadHeaderEnvelope,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadHeaderEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadEnvelopeContents = new ContainerType(
  {
    ...gloasSsz.SignedExecutionPayloadEnvelopeContents.fields,
    signedExecutionPayloadEnvelope: SignedExecutionPayloadEnvelope,
  },
  {typeName: "SignedExecutionPayloadEnvelopeContents", jsonCase: "eth2"}
);

const {
  eth1Data: _eth1Data,
  eth1DataVotes: _eth1DataVotes,
  eth1DepositIndex: _eth1DepositIndex,
  depositRequestsStartIndex: _depositRequestsStartIndex,
  ...gloasBeaconStateFields
} = gloasSsz.BeaconState.fields;

export const BeaconState = new ProgressiveContainerType(
  {
    ...gloasBeaconStateFields,
    latestExecutionPayloadBid: ExecutionPayloadBid, // [Modified in Heze:EIP7805]
  },
  // [Modified in Heze:EIP8015] gaps keep the surviving generalized indices stable
  activeFields(46, [8, 9, 10, 28]),
  {typeName: "BeaconState", jsonCase: "eth2"}
);

const {eth1Data: _bodyEth1Data, deposits: _deposits, ...gloasBeaconBlockBodyFields} = gloasSsz.BeaconBlockBody.fields;

export const BeaconBlockBody = new ProgressiveContainerType(
  {
    ...gloasBeaconBlockBodyFields,
    signedExecutionPayloadBid: SignedExecutionPayloadBid, // [Modified in Heze:EIP7805]
    parentExecutionRequests: ExecutionRequests, // [Modified in Heze:EIP8148]
  },
  // [Modified in Heze:EIP8015] gaps keep the surviving generalized indices stable
  activeFields(13, [1, 6]),
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
    executionPayloadEnvelope: ExecutionPayloadEnvelope, // [Modified in Heze:EIP8148]
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
