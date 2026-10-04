import {
  BitVectorType,
  ContainerType,
  ListBasicType,
  ProgressiveContainerType,
  ProgressiveListCompositeType,
  VectorBasicType,
  VectorCompositeType,
} from "@chainsafe/ssz";
import {
  AVAILABLE_CHAIN_COMMITTEE_SIZE,
  COMMITTEES_PER_ROUND,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as hezeSsz} from "../heze/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Root, BLSSignature, ValidatorIndex, UintNum64, UintNumInf64, Uint8} = primitiveSsz;

function activeFields(count: number): boolean[] {
  return Array.from({length: count}, () => true);
}

// Spec: Height (decoupled-consensus/beacon-chain.md). EMPTY_HEIGHT = 2**64 - 1 is Infinity in code.
export const Height = UintNumInf64;
// Spec: Round (decoupled-consensus/beacon-chain.md)
export const Round = UintNum64;
// Spec: PayloadStatus (gloas/fork-choice.md), reused by AvailableChainAttestationData
export const PayloadStatus = Uint8;

// Spec: AvailableChainCommitteeIndices (decoupled-consensus/beacon-chain.md)
export const AvailableChainCommitteeIndices = new ListBasicType(ValidatorIndex, AVAILABLE_CHAIN_COMMITTEE_SIZE);
// Spec: AvailableChainCommittee (decoupled-consensus/beacon-chain.md)
export const AvailableChainCommittee = new VectorBasicType(ValidatorIndex, AVAILABLE_CHAIN_COMMITTEE_SIZE);
// Spec: AvailableChainParticipation (decoupled-consensus/beacon-chain.md)
export const AvailableChainParticipation = new VectorCompositeType(AvailableChainCommitteeIndices, 2 * SLOTS_PER_EPOCH);
// Spec: CommitteeBits [Modified in DC] (decoupled-consensus/beacon-chain.md)
export const CommitteeBits = new BitVectorType(COMMITTEES_PER_ROUND);

// Spec: HeightPair (decoupled-consensus/beacon-chain.md)
export const HeightPair = new ContainerType(
  {
    height: Height,
    root: Root,
  },
  {typeName: "HeightPair", jsonCase: "eth2"}
);

// Spec: AttestationData2 (decoupled-consensus/beacon-chain.md)
export const AttestationData2 = new ContainerType(
  {
    round: Round,
    finalizePair: HeightPair,
    targetPair: HeightPair,
  },
  {typeName: "AttestationData2", jsonCase: "eth2"}
);

// Spec: IndexedAttestation2 (decoupled-consensus/beacon-chain.md)
export const IndexedAttestation2 = new ProgressiveContainerType(
  {
    attestingIndices: gloasSsz.AttestingIndices,
    data: AttestationData2,
    signature: BLSSignature,
  },
  activeFields(3),
  {typeName: "IndexedAttestation2", jsonCase: "eth2"}
);

// Spec: AttesterSlashing2 (decoupled-consensus/beacon-chain.md)
export const AttesterSlashing2 = new ContainerType(
  {
    attestation1: IndexedAttestation2,
    attestation2: IndexedAttestation2,
  },
  {typeName: "AttesterSlashing2", jsonCase: "eth2"}
);

export const AttesterSlashings2 = new ProgressiveListCompositeType(AttesterSlashing2, {
  typeName: "AttesterSlashings2",
  limit: MAX_ATTESTER_SLASHINGS_ELECTRA,
});

// Spec: AvailableChainAttestationData (decoupled-consensus/beacon-chain.md)
export const AvailableChainAttestationData = new ContainerType(
  {
    root: Root,
    slot: Slot,
    payloadStatus: PayloadStatus,
  },
  {typeName: "AvailableChainAttestationData", jsonCase: "eth2"}
);

// Spec: AvailableChainAttestation (decoupled-consensus/beacon-chain.md)
export const AvailableChainAttestation = new ProgressiveContainerType(
  {
    attestingIndices: AvailableChainCommitteeIndices,
    data: AvailableChainAttestationData,
    signature: BLSSignature,
  },
  activeFields(3),
  {typeName: "AvailableChainAttestation", jsonCase: "eth2"}
);

// The spec puts no bound on this list, see DC-ISSUES.md "available_chain_attestations is unbounded"
export const AvailableChainAttestations = new ProgressiveListCompositeType(AvailableChainAttestation, {
  typeName: "AvailableChainAttestations",
});

// Spec: Attestation [Modified in DC] (decoupled-consensus/beacon-chain.md)
// active_fields(width=5, gaps=(1)): the legacy `data` chunk at index 1 is a gap, AttestationData2 is chunk 4
export const Attestation = new ProgressiveContainerType(
  {
    aggregationBits: gloasSsz.AggregationBits,
    signature: BLSSignature,
    committeeBits: CommitteeBits, // [Modified in DC]
    data: AttestationData2, // [New in DC]
  },
  [true, false, true, true, true],
  {typeName: "Attestation", jsonCase: "eth2"}
);

export const Attestations = new ProgressiveListCompositeType(Attestation, {
  typeName: "Attestations",
  limit: MAX_ATTESTATIONS_ELECTRA,
});

// Spec: BeaconBlockBody [Modified in DC] (decoupled-consensus/beacon-chain.md)
export const BeaconBlockBody = new ProgressiveContainerType(
  {
    ...hezeSsz.BeaconBlockBody.fields,
    attestations: Attestations, // [Modified in DC]
    availableChainAttestations: AvailableChainAttestations, // [New in DC]
    attesterSlashings2: AttesterSlashings2, // [New in DC]
  },
  activeFields(15),
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...hezeSsz.BeaconBlock.fields,
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
    ...hezeSsz.BlockContents.fields,
    block: BeaconBlock,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

// Spec: BeaconState [Modified in DC] (decoupled-consensus/beacon-chain.md)
export const BeaconState = new ProgressiveContainerType(
  {
    ...hezeSsz.BeaconState.fields,
    builderPaymentParticipation: AvailableChainParticipation, // [New in DC]
    heightParticipation: gloasSsz.EpochParticipation, // [New in DC]
    previousRoundParticipation: gloasSsz.EpochParticipation, // [New in DC]
    currentRoundParticipation: gloasSsz.EpochParticipation, // [New in DC]
    finalizedPair: HeightPair, // [New in DC]
    justifiedPair: HeightPair, // [New in DC]
    targetPair: HeightPair, // [New in DC]
    finalizedSlot: Slot, // [New in DC]
    justifiedSlot: Slot, // [New in DC]
    targetSlot: Slot, // [New in DC]
  },
  activeFields(56),
  {typeName: "BeaconState", jsonCase: "eth2"}
);
