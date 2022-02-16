import {BitVector, List, BitList, Vector} from "@chainsafe/ssz";
import {
  Number64,
  Uint64,
  ParticipationFlags,
  Bytes32,
  BLSSignature,
  Version,
  BLSPubkey,
  Slot,
  Root,
  ValidatorIndex,
  SubcommitteeIndex,
} from "../primitive/types";
import * as phase0 from "../phase0/types";

export type SyncSubnets = BitVector;

export interface Metadata {
  seqNumber: Uint64;
  attnets: phase0.AttestationSubnets;
  syncnets: SyncSubnets;
}

export interface SyncCommittee {
  pubkeys: Vector<BLSPubkey>;
  aggregatePubkey: BLSPubkey;
}

export interface SyncCommitteeMessage {
  slot: Slot;
  beaconBlockRoot: Root;
  validatorIndex: ValidatorIndex;
  signature: BLSSignature;
}

export interface SyncCommitteeContribution {
  slot: Slot;
  beaconBlockRoot: Root;
  subcommitteeIndex: SubcommitteeIndex;
  aggregationBits: BitList;
  signature: BLSSignature;
}

export interface ContributionAndProof {
  aggregatorIndex: ValidatorIndex;
  contribution: SyncCommitteeContribution;
  selectionProof: BLSSignature;
}

export interface SignedContributionAndProof {
  message: ContributionAndProof;
  signature: BLSSignature;
}

export interface SyncAggregatorSelectionData {
  slot: Slot;
  subcommitteeIndex: SubcommitteeIndex;
}

export interface SyncAggregate {
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: BLSSignature;
}

export interface BeaconBlockBody extends phase0.BeaconBlockBody {
  syncAggregate: SyncAggregate;
}

export interface BeaconBlock extends phase0.BeaconBlock {
  body: BeaconBlockBody;
}

export interface SignedBeaconBlock extends phase0.SignedBeaconBlock {
  message: BeaconBlock;
}

export interface BeaconState
  extends Omit<phase0.BeaconState, "previousEpochAttestations" | "currentEpochAttestations"> {
  // Participation
  previousEpochParticipation: List<ParticipationFlags>;
  currentEpochParticipation: List<ParticipationFlags>;
  // Inactivity
  inactivityScores: List<Number64>;
  // Sync
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}

/**
 * Spec v1.0.1
 */
export interface LightClientUpdate {
  /** The beacon block header that is attested to by the sync committee */
  attestedHeader: phase0.BeaconBlockHeader;
  /** Next sync committee corresponding to the header */
  nextSyncCommittee: SyncCommittee;
  nextSyncCommitteeBranch: Vector<Bytes32>;
  /** The finalized beacon block header attested to by Merkle branch */
  finalizedHeader: phase0.BeaconBlockHeader;
  finalityBranch: Vector<Bytes32>;
  /** Sync committee aggregate signature */
  syncAggregate: SyncAggregate;
  /** Fork version for the aggregate signature */
  forkVersion: Version;
}

/**
 * Spec v1.0.1
 */
export interface LightClientStore {
  /** Beacon block header that is finalized */
  finalizedHeader: phase0.BeaconBlockHeader;
  /** Sync committees corresponding to the header */
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
  /** Best available header to switch finalized head to if we see nothing else */
  bestValidUpdate?: LightClientUpdate;
  /** Most recent available reasonably-safe header */
  optimisticHeader: phase0.BeaconBlockHeader;
  /** Max number of active participants in a sync committee (used to calculate
   * safety threshold)
   */
  previousMaxActiveParticipants: Uint64;
  currentMaxActiveParticipants: Uint64;
}
