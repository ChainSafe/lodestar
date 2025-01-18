import {BitVectorType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {INCLUSION_LIST_COMMITTEE_SIZE, MAX_TRANSACTIONS_PER_INCLUSION_LIST} from "@lodestar/params";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, ValidatorIndex} = primitiveSsz;

export const InclusionList = new ContainerType({
  slot: Slot,
  validatorIndex: ValidatorIndex,
  inclusionListCommitteeRoot: Root,
  transactions: new ListCompositeType(bellatrixSsz.Transaction, MAX_TRANSACTIONS_PER_INCLUSION_LIST),
});

export const SignedInclusionList = new ContainerType({
  message: InclusionList,
  signature: BLSSignature,
});

export const InclusionListByCommitteeIndicesRequest = new ContainerType({
  slot: Slot,
  committeeIndices: new BitVectorType(INCLUSION_LIST_COMMITTEE_SIZE),
});

export const BeaconState = new ContainerType({
  ...electraSsz.BeaconState.fields,
});

export const BeaconBlockBody = new ContainerType({
  ...electraSsz.BeaconBlockBody.fields,
});

export const BeaconBlock = new ContainerType({
  ...electraSsz.BeaconBlock.fields,
});

export const SignedBeaconBlock = new ContainerType({
  ...electraSsz.SignedBeaconBlock.fields,
});

export const BlindedBeaconBlockBody = new ContainerType({
  ...electraSsz.BlindedBeaconBlockBody.fields,
});

export const SignedBlindedBeaconBlock = new ContainerType({
  ...electraSsz.SignedBlindedBeaconBlock.fields,
});

export const ExecutionPayload = new ContainerType({
  ...electraSsz.ExecutionPayload.fields,
});

export const ExecutionPayloadHeader = new ContainerType({
  ...electraSsz.ExecutionPayloadHeader.fields,
});
