import {
  ByteListType,
  ByteVectorType,
  ContainerNodeStructType,
  ContainerType,
  ProgressiveContainerType,
  ProgressiveListCompositeType,
  VectorCompositeType,
} from "@chainsafe/ssz";
import {
  MAX_ATTESTATIONS_PQ,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_PREREGISTRATION_REQUESTS_PER_PAYLOAD,
  MAX_PROPOSER_SLASHINGS,
  MAX_STARK_PROOF_SIZE,
  MAX_VOLUNTARY_EXITS,
  VALIDATOR_REGISTRY_LIMIT,
  VRF_TREE_DEPTH,
  XMSS_SIGNATURE_SIZE,
} from "@lodestar/params";
import {ssz as denebSsz} from "../deneb/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as fuluSsz} from "../fulu/index.js";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

// biome-ignore lint/suspicious/noShadowRestrictedNames: We explicitly want `Boolean` name to be imported
const {Boolean} = primitiveSsz;
const {
  Bytes32,
  BuilderIndex,
  CommitteeIndex,
  EpochInf,
  ExecutionAddress,
  Root,
  Slot,
  Uint8,
  UintNum64,
  ValidatorIndex,
} = primitiveSsz;

function activeFields(count: number, gaps: number[] = []): boolean[] {
  return Array.from({length: count}, (_, index) => !gaps.includes(index));
}

/** A leanXMSS public key: the Merkle root then the public parameter */
export const XMSSPubkey = Bytes32;
/** A leanXMSS signature: the leaf index then one signature per layer */
export const XMSSSignature = new ByteVectorType(XMSS_SIGNATURE_SIZE);
/** A leaf of a validator's VRF tree then the leaf's Merkle branch */
export const VRFProof = new VectorCompositeType(Bytes32, VRF_TREE_DEPTH + 1);
/** A proof of the leanXMSS signatures of attestations */
export const AttestationProof = new ByteListType(MAX_STARK_PROOF_SIZE);

export const Validator = new ContainerNodeStructType(
  {
    pubkey: XMSSPubkey,
    vrfRoot: Root,
    withdrawalCredentials: Bytes32,
    effectiveBalance: UintNum64,
    slashed: Boolean,
    activationEligibilityEpoch: EpochInf,
    activationEpoch: EpochInf,
    exitEpoch: EpochInf,
    withdrawableEpoch: EpochInf,
  },
  {typeName: "Validator", jsonCase: "eth2"}
);

export const Validators = new ProgressiveListCompositeType(Validator, {
  typeName: "Validators",
  limit: VALIDATOR_REGISTRY_LIMIT,
});

export const SignedBeaconBlockHeader = new ContainerType(
  {
    message: phase0Ssz.BeaconBlockHeader,
    signature: XMSSSignature,
  },
  {typeName: "SignedBeaconBlockHeader", jsonCase: "eth2"}
);

/** Same as `SignedBeaconBlockHeader` but slot is not bounded by the clock and must be a bigint */
export const SignedBeaconBlockHeaderBigint = new ContainerType(
  {
    message: phase0Ssz.BeaconBlockHeaderBigint,
    signature: XMSSSignature,
  },
  {typeName: "SignedBeaconBlockHeader", jsonCase: "eth2"}
);

export const ProposerSlashing = new ContainerType(
  {
    signedHeader1: SignedBeaconBlockHeaderBigint,
    signedHeader2: SignedBeaconBlockHeaderBigint,
  },
  {typeName: "ProposerSlashing", jsonCase: "eth2"}
);

export const ProposerSlashings = new ProgressiveListCompositeType(ProposerSlashing, {
  typeName: "ProposerSlashings",
  limit: MAX_PROPOSER_SLASHINGS,
});

export const SignedVoluntaryExit = new ContainerType(
  {
    message: phase0Ssz.VoluntaryExit,
    signature: XMSSSignature,
  },
  {typeName: "SignedVoluntaryExit", jsonCase: "eth2"}
);

export const VoluntaryExits = new ProgressiveListCompositeType(SignedVoluntaryExit, {
  typeName: "VoluntaryExits",
  limit: MAX_VOLUNTARY_EXITS,
});

export const SingleAttestation = new ContainerType(
  {
    committeeIndex: CommitteeIndex,
    attesterIndex: ValidatorIndex,
    data: phase0Ssz.AttestationData,
    signature: XMSSSignature,
  },
  {typeName: "SingleAttestation", jsonCase: "eth2"}
);

// `signature` is removed: a proof covers the signatures of every attestation of a block or an aggregate
export const Attestation = new ProgressiveContainerType(
  {
    aggregationBits: gloasSsz.AggregationBits,
    data: phase0Ssz.AttestationData,
    committeeBits: electraSsz.CommitteeBits,
  },
  activeFields(4, [2]),
  {typeName: "Attestation", jsonCase: "eth2"}
);

/**
 * What a beacon node hands an aggregator: the aggregate of a committee and the proof of its
 * attesters' signatures, which the aggregator puts in its `AggregateAndProof`. Not a spec
 * container, never hashed.
 */
export const AttestationWithProof = new ContainerType(
  {
    ...Attestation.fields,
    proof: AttestationProof,
  },
  {typeName: "AttestationWithProof", jsonCase: "eth2"}
);

export const Attestations = new ProgressiveListCompositeType(Attestation, {
  typeName: "Attestations",
  limit: MAX_ATTESTATIONS_PQ,
});

export const IndexedAttestation = new ProgressiveContainerType(
  {
    attestingIndices: gloasSsz.AttestingIndices,
    data: phase0Ssz.AttestationData,
    proof: AttestationProof,
  },
  activeFields(3),
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

/** Same as `IndexedAttestation` but epoch, slot and index are not bounded and must be a bigint */
export const IndexedAttestationBigint = new ProgressiveContainerType(
  {
    attestingIndices: gloasSsz.AttestingIndices,
    data: phase0Ssz.AttestationDataBigint,
    proof: AttestationProof,
  },
  activeFields(3),
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

export const AttesterSlashing = new ContainerType(
  {
    attestation1: IndexedAttestationBigint,
    attestation2: IndexedAttestationBigint,
  },
  {typeName: "AttesterSlashing", jsonCase: "eth2"}
);

export const AttesterSlashings = new ProgressiveListCompositeType(AttesterSlashing, {
  typeName: "AttesterSlashings",
  limit: MAX_ATTESTER_SLASHINGS_ELECTRA,
});

export const AggregateAndProof = new ContainerType(
  {
    aggregatorIndex: ValidatorIndex,
    aggregate: Attestation,
    selectionProof: VRFProof,
    proof: AttestationProof,
  },
  {typeName: "AggregateAndProof", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedAggregateAndProof = new ContainerType(
  {
    message: AggregateAndProof,
    signature: XMSSSignature,
  },
  {typeName: "SignedAggregateAndProof", jsonCase: "eth2"}
);

export const Builder = new ContainerType(
  {
    pubkey: XMSSPubkey,
    version: Uint8,
    executionAddress: ExecutionAddress,
    balance: UintNum64,
    depositEpoch: EpochInf,
    withdrawableEpoch: EpochInf,
  },
  {typeName: "Builder", jsonCase: "eth2"}
);

export const Builders = new ProgressiveListCompositeType(Builder, {typeName: "Builders"});

export const PayloadAttestationMessage = new ContainerType(
  {
    validatorIndex: ValidatorIndex,
    data: gloasSsz.PayloadAttestationData,
    signature: XMSSSignature,
  },
  {typeName: "PayloadAttestationMessage", jsonCase: "eth2"}
);

export const SignedProposerPreferences = new ContainerType(
  {
    message: gloasSsz.ProposerPreferences,
    signature: XMSSSignature,
  },
  {typeName: "SignedProposerPreferences", jsonCase: "eth2"}
);

export const SignedExecutionPayloadBid = new ContainerType(
  {
    message: gloasSsz.ExecutionPayloadBid,
    signature: XMSSSignature,
  },
  {typeName: "SignedExecutionPayloadBid", jsonCase: "eth2"}
);

/** The signing container of a preregistration */
export const ValidatorPreregistration = new ContainerType(
  {
    pubkey: XMSSPubkey,
    withdrawalCredentials: Bytes32,
    vrfRoot: Root,
  },
  {typeName: "ValidatorPreregistration", jsonCase: "eth2"}
);

export const PreregistrationRequest = new ContainerType(
  {
    pubkey: XMSSPubkey,
    withdrawalCredentials: Bytes32,
    vrfRoot: Root,
    signature: XMSSSignature,
  },
  {typeName: "PreregistrationRequest", jsonCase: "eth2"}
);

export const StoredPreregistration = new ContainerType(
  {
    pubkey: XMSSPubkey,
    withdrawalCredentials: Bytes32,
    vrfRoot: Root,
    expirySlot: Slot,
  },
  {typeName: "StoredPreregistration", jsonCase: "eth2"}
);

export const PreregistrationRequests = new ProgressiveListCompositeType(PreregistrationRequest, {
  typeName: "PreregistrationRequests",
  limit: MAX_PREREGISTRATION_REQUESTS_PER_PAYLOAD,
});

// Unbounded: `PREREGISTRATIONS_LIMIT` caps the active records, and expired ones stay until swept
export const ValidatorPreregistrations = new ProgressiveListCompositeType(StoredPreregistration, {
  typeName: "ValidatorPreregistrations",
});

// Indices 5 and 6 held the EIP-8483 registration requests
export const ExecutionRequests = new ProgressiveContainerType(
  {
    ...gloasSsz.ExecutionRequests.fields,
    preregistrations: PreregistrationRequests,
  },
  activeFields(8, [5, 6]),
  {typeName: "ExecutionRequests", jsonCase: "eth2"}
);

export const NewPayloadRequest = new ProgressiveContainerType(
  {
    ...gloasSsz.NewPayloadRequest.fields,
    executionRequests: ExecutionRequests,
  },
  activeFields(4),
  {typeName: "NewPayloadRequest", jsonCase: "eth2"}
);

export const ExecutionPayloadEnvelope = new ProgressiveContainerType(
  {
    payload: gloasSsz.ExecutionPayload,
    executionRequests: ExecutionRequests,
    builderIndex: BuilderIndex,
    beaconBlockRoot: Root,
    parentBeaconBlockRoot: Root,
  },
  activeFields(5),
  {typeName: "ExecutionPayloadEnvelope", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedExecutionPayloadEnvelope = new ContainerType(
  {
    message: ExecutionPayloadEnvelope,
    signature: XMSSSignature,
  },
  {typeName: "SignedExecutionPayloadEnvelope", jsonCase: "eth2"}
);

const {payload: _payload, ...envelopeFieldsWithoutPayload} = ExecutionPayloadEnvelope.fields;
/** Same field positions as ExecutionPayloadEnvelope, so it hashes to the same root */
export const ExecutionPayloadHeaderEnvelope = new ProgressiveContainerType(
  {
    payloadHeader: gloasSsz.ExecutionPayloadHeaderEnvelope.fields.payloadHeader,
    ...envelopeFieldsWithoutPayload,
  },
  activeFields(5),
  {typeName: "ExecutionPayloadHeaderEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadHeaderEnvelope = new ContainerType(
  {
    message: ExecutionPayloadHeaderEnvelope,
    signature: XMSSSignature,
  },
  {typeName: "SignedExecutionPayloadHeaderEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadEnvelopeContents = new ContainerType(
  {
    signedExecutionPayloadEnvelope: SignedExecutionPayloadEnvelope,
    kzgProofs: fuluSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "SignedExecutionPayloadEnvelopeContents", jsonCase: "eth2"}
);

const {
  syncAggregate: _syncAggregate,
  blsToExecutionChanges: _blsToExecutionChanges,
  payloadAttestations: _payloadAttestations,
  ...bodyFields
} = gloasSsz.BeaconBlockBody.fields;

// Removed: syncAggregate (8), blsToExecutionChanges (9), payloadAttestations (11)
export const BeaconBlockBody = new ProgressiveContainerType(
  {
    ...bodyFields,
    randaoReveal: VRFProof,
    proposerSlashings: ProposerSlashings,
    attesterSlashings: AttesterSlashings,
    attestations: Attestations,
    voluntaryExits: VoluntaryExits,
    signedExecutionPayloadBid: SignedExecutionPayloadBid,
    parentExecutionRequests: ExecutionRequests,
    proof: AttestationProof,
  },
  activeFields(14, [8, 9, 11]),
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
    signature: XMSSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlockContents = new ContainerType(
  {
    block: BeaconBlock,
    executionPayloadEnvelope: ExecutionPayloadEnvelope,
    kzgProofs: fuluSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

const {
  currentSyncCommittee: _currentSyncCommittee,
  nextSyncCommittee: _nextSyncCommittee,
  ...stateFields
} = gloasSsz.BeaconState.fields;

// Removed: the sync committees (22, 23) and the EIP-8483 registrations (46, 47)
export const BeaconState = new ProgressiveContainerType(
  {
    ...stateFields,
    validators: Validators,
    builders: Builders,
    validatorPreregistrations: ValidatorPreregistrations,
  },
  activeFields(49, [22, 23, 46, 47]),
  {typeName: "BeaconState", jsonCase: "eth2"}
);
