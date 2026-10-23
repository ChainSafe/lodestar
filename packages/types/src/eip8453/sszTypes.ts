import {
  BitVectorType,
  ContainerType,
  ListCompositeType,
  ProgressiveBitListType,
  ProgressiveContainerType,
  ProgressiveListBasicType,
  ProgressiveListCompositeType,
  VectorBasicType,
  VectorCompositeType,
} from "@chainsafe/ssz";
import {
  ATTESTATION_COMMITTEES_PER_ROUND,
  HEAD_VOTE_COMMITTEE_SIZE,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_HEAD_VOTES,
  PENDING_FINALITY_WINDOW,
  SLOTS_PER_EPOCH,
  VALIDATOR_REGISTRY_LIMIT,
} from "@lodestar/params";
import {ssz as gloasSsz} from "../gloas/index.js";
import {ssz as hezeSsz} from "../heze/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

const {Slot, Epoch, Root, BLSSignature, ValidatorIndex, CommitteeIndex, UintNum64, UintBn64, ParticipationFlags} =
  primitiveSsz;
const BooleanSsz = primitiveSsz.Boolean;

function activeFields(count: number, gaps: number[] = []): boolean[] {
  return Array.from({length: count}, (_, index) => !gaps.includes(index));
}

// Spec: specs/_features/eip8453/beacon-chain.md (ethereum/consensus-specs decoupled-consensus branch)

// Custom types

export const Height = UintNum64;
export const Round = UintNum64;

export const AttestationCommittee = new ProgressiveListBasicType(ValidatorIndex, {
  typeName: "AttestationCommittee",
  limit: VALIDATOR_REGISTRY_LIMIT,
});

export const AttestationCommitteeBits = new BitVectorType(ATTESTATION_COMMITTEES_PER_ROUND);

export const HeadVoteCommittee = new VectorBasicType(ValidatorIndex, HEAD_VOTE_COMMITTEE_SIZE);

export const HeadVoteCommitteeBits = new BitVectorType(HEAD_VOTE_COMMITTEE_SIZE);

export const HeadVoteParticipation = new VectorCompositeType(HeadVoteCommitteeBits, 2 * SLOTS_PER_EPOCH);

export const HeadVoteSupportBits = new ProgressiveBitListType({
  typeName: "HeadVoteSupportBits",
  limit: MAX_HEAD_VOTES,
});

export const HeightParticipation = new ProgressiveListBasicType(BooleanSsz, {
  typeName: "HeightParticipation",
  limit: VALIDATOR_REGISTRY_LIMIT,
});

export const RoundParticipation = new ProgressiveListBasicType(ParticipationFlags, {
  typeName: "RoundParticipation",
  limit: VALIDATOR_REGISTRY_LIMIT,
});

// Containers

export const HeightCheckpoint = new ContainerType(
  {
    height: Height,
    root: Root,
  },
  {typeName: "HeightCheckpoint", jsonCase: "eth2"}
);

/** Same as `HeightCheckpoint` but height is not bounded and must be a bigint, for attester slashings */
export const HeightCheckpointBigint = new ContainerType(
  {
    height: UintBn64,
    root: Root,
  },
  {typeName: "HeightCheckpoint", jsonCase: "eth2"}
);

export const PendingFinality = new ContainerType(
  {
    checkpoint: HeightCheckpoint,
    slot: Slot,
    participation: HeightParticipation,
  },
  {typeName: "PendingFinality", jsonCase: "eth2"}
);

export const PendingFinalities = new ListCompositeType(PendingFinality, PENDING_FINALITY_WINDOW);

export const HeadVoteData = new ContainerType(
  {
    slot: Slot,
    beaconBlockRoot: Root,
  },
  {typeName: "HeadVoteData", jsonCase: "eth2"}
);

export const HeadVote = new ProgressiveContainerType(
  {
    aggregationBits: HeadVoteCommitteeBits,
    data: HeadVoteData,
    signature: BLSSignature,
  },
  activeFields(3),
  {typeName: "HeadVote", jsonCase: "eth2"}
);

export const HeadVotes = new ProgressiveListCompositeType(HeadVote, {
  typeName: "HeadVotes",
  limit: MAX_HEAD_VOTES,
});

export const HeadVoteMessage = new ContainerType(
  {
    validatorIndex: ValidatorIndex,
    data: HeadVoteData,
    signature: BLSSignature,
  },
  {typeName: "HeadVoteMessage", jsonCase: "eth2"}
);

/**
 * The height pair is (`target`, `timeout`): a target vote when `timeout` is false, and a timeout when it is true.
 * The finality pair is `finality`; the empty checkpoint stands for an absent finality pair.
 */
export const AttestationData = new ContainerType(
  {
    target: HeightCheckpoint, // [Modified in EIP8453]
    timeout: BooleanSsz, // [New in EIP8453]
    finality: HeightCheckpoint, // [New in EIP8453]
  },
  {typeName: "AttestationData", jsonCase: "eth2"}
);

/** Same as `AttestationData` but heights are not bounded and must be a bigint */
export const AttestationDataBigint = new ContainerType(
  {
    target: HeightCheckpointBigint,
    timeout: BooleanSsz,
    finality: HeightCheckpointBigint,
  },
  {typeName: "AttestationData", jsonCase: "eth2"}
);

export const SingleAttestation = new ContainerType(
  {
    committeeIndex: CommitteeIndex,
    attesterIndex: ValidatorIndex,
    data: AttestationData, // [Modified in EIP8453]
    signature: BLSSignature,
    epoch: Epoch, // [New in EIP8453]
  },
  {typeName: "SingleAttestation", jsonCase: "eth2"}
);

/**
 * `epoch` is not signed. It selects the attestation committees that `committeeBits` and `aggregationBits`
 * refer to, and the signature domain.
 */
export const Attestation = new ProgressiveContainerType(
  {
    aggregationBits: gloasSsz.AggregationBits,
    data: AttestationData, // [Modified in EIP8453]
    signature: BLSSignature,
    committeeBits: AttestationCommitteeBits, // [Modified in EIP8453]
    epoch: Epoch, // [New in EIP8453]
  },
  activeFields(5),
  {typeName: "Attestation", jsonCase: "eth2"}
);

export const Attestations = new ProgressiveListCompositeType(Attestation, {
  typeName: "Attestations",
  limit: MAX_ATTESTATIONS_ELECTRA,
});

export const IndexedAttestation = new ProgressiveContainerType(
  {
    attestingIndices: gloasSsz.AttestingIndices,
    data: AttestationData, // [Modified in EIP8453]
    signature: BLSSignature,
    epoch: Epoch, // [New in EIP8453]
  },
  activeFields(4),
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

/** Same as `IndexedAttestation` but heights and epoch are not bounded and must be a bigint */
export const IndexedAttestationBigint = new ProgressiveContainerType(
  {
    attestingIndices: gloasSsz.AttestingIndices,
    data: AttestationDataBigint,
    signature: BLSSignature,
    epoch: UintBn64,
  },
  activeFields(4),
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

/** Slashings of attestations made before EIP8453, to be removed in a later upgrade */
export const LegacyAttesterSlashings = new ProgressiveListCompositeType(gloasSsz.AttesterSlashing, {
  typeName: "LegacyAttesterSlashings",
  limit: MAX_ATTESTER_SLASHINGS_ELECTRA,
});

const hezeBody = hezeSsz.BeaconBlockBody.fields;

export const BeaconBlockBody = new ProgressiveContainerType(
  {
    randaoReveal: hezeBody.randaoReveal,
    graffiti: hezeBody.graffiti,
    proposerSlashings: hezeBody.proposerSlashings,
    attesterSlashings: AttesterSlashings, // [Modified in EIP8453]
    attestations: Attestations, // [Modified in EIP8453]
    voluntaryExits: hezeBody.voluntaryExits,
    syncAggregate: hezeBody.syncAggregate,
    blsToExecutionChanges: hezeBody.blsToExecutionChanges,
    signedExecutionPayloadBid: hezeBody.signedExecutionPayloadBid,
    payloadAttestations: hezeBody.payloadAttestations,
    parentExecutionRequests: hezeBody.parentExecutionRequests,
    headVotes: HeadVotes, // [New in EIP8453]
    headVoteSupportBits: HeadVoteSupportBits, // [New in EIP8453]
    legacyAttesterSlashings: LegacyAttesterSlashings, // [New in EIP8453]
  },
  // Field order is chunk order. Heze gaps (eth1Data, deposits) keep the surviving generalized indices stable
  activeFields(16, [1, 6]),
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...hezeSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // [Modified in EIP8453]
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // [Modified in EIP8453]
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlockContents = new ContainerType(
  {
    ...hezeSsz.BlockContents.fields,
    block: BeaconBlock, // [Modified in EIP8453]
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

const {
  previousEpochParticipation: _previousEpochParticipation,
  currentEpochParticipation: _currentEpochParticipation,
  justificationBits: _justificationBits,
  previousJustifiedCheckpoint: _previousJustifiedCheckpoint,
  currentJustifiedCheckpoint: _currentJustifiedCheckpoint,
  finalizedCheckpoint: _finalizedCheckpoint,
  ...hezeBeaconStateFields
} = hezeSsz.BeaconState.fields;

/**
 * The positions of the epoch participation and Casper FFG fields are left as gaps, so their generalized
 * indices are never reused. `finalizedCheckpoint` keeps its name but moves to a new position and is a
 * `HeightCheckpoint`.
 */
export const BeaconState = new ProgressiveContainerType(
  {
    ...hezeBeaconStateFields,
    targetCheckpoint: HeightCheckpoint, // [New in EIP8453]
    justifiedCheckpoint: HeightCheckpoint, // [New in EIP8453]
    finalizedCheckpoint: HeightCheckpoint, // [New in EIP8453]
    targetSlot: Slot, // [New in EIP8453]
    finalizedSlot: Slot, // [New in EIP8453]
    targetParticipation: HeightParticipation, // [New in EIP8453]
    progressParticipation: HeightParticipation, // [New in EIP8453]
    roundParticipation: RoundParticipation, // [New in EIP8453]
    pendingFinality: PendingFinalities, // [New in EIP8453]
    headVoteParticipation: HeadVoteParticipation, // [New in EIP8453]
  },
  // Heze gaps (8, 9, 10, 28) plus the removed participation and Casper FFG fields (15..20)
  activeFields(56, [8, 9, 10, 15, 16, 17, 18, 19, 20, 28]),
  {typeName: "BeaconState", jsonCase: "eth2"}
);
