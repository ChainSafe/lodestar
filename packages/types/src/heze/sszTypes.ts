import {BitVectorType, ContainerType, ListCompositeType, VectorBasicType} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE, MAX_TRANSACTIONS_PER_PAYLOAD} from "@lodestar/params";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as denebSsz} from "../deneb/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, ValidatorIndex} = primitiveSsz;

export const InclusionListCommittee = new VectorBasicType(ValidatorIndex, INCLUSION_LIST_COMMITTEE_SIZE);

// Per InclusionList container; bound is MAX_TRANSACTIONS_PER_PAYLOAD.
export const InclusionListTransactions = new ListCompositeType(bellatrixSsz.Transaction, MAX_TRANSACTIONS_PER_PAYLOAD);

// Aggregated IL transactions surfaced in PayloadAttributes/EL: bounded by total committee output.
export const AggregatedInclusionListTransactions = new ListCompositeType(
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

// [EIP7805] consensus-specs#5371 removed `inclusion_list_bits` from the bid, so Heze no longer
// modifies `ExecutionPayloadBid` / `SignedExecutionPayloadBid`; they are identical to Gloas.
export const ExecutionPayloadBid = gloasSsz.ExecutionPayloadBid;

export const SignedExecutionPayloadBid = gloasSsz.SignedExecutionPayloadBid;

export const DataColumnSidecar = gloasSsz.DataColumnSidecar;
export const DataColumnSidecars = gloasSsz.DataColumnSidecars;

// [EIP7805] consensus-specs#5371 removed `inclusion_list_bits` from the bid (the only Heze
// delta in these containers), so Heze `BeaconState` / `BeaconBlockBody` are now identical to
// Gloas — reuse the Gloas containers directly (same convention as fulu's `BeaconBlock`).
export const BeaconState = gloasSsz.BeaconState;

export const BeaconBlockBody = gloasSsz.BeaconBlockBody;

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

// Gloas does not define blinded block types (post-ePBS uses bid/envelope split).
// Heze inherits the electra blinded types for code paths still expecting them.
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
    ...gloasSsz.ExecutionPayload.fields,
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event
export const PayloadAttributes = new ContainerType(
  {
    ...gloasSsz.PayloadAttributes.fields,
    inclusionListTransactions: AggregatedInclusionListTransactions,
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
