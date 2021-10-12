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
  SubCommitteeIndex,
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
  subCommitteeIndex: SubCommitteeIndex;
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
  subCommitteeIndex: SubCommitteeIndex;
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
export interface LightClientSnapshot {
  /** Beacon block header */
  header: phase0.BeaconBlockHeader;
  /** Sync committees corresponding to the header */
  currentSyncCommittee: SyncCommittee;
  nextSyncCommittee: SyncCommittee;
}

/**
 * Spec v1.0.1
 */
export interface LightClientUpdate {
  /** Update beacon block header */
  header: phase0.BeaconBlockHeader;
  /** Next sync committee corresponding to the header */
  nextSyncCommittee: SyncCommittee;
  nextSyncCommitteeBranch: Vector<Bytes32>;
  /** Finality proof for the update header */
  finalityHeader: phase0.BeaconBlockHeader;
  finalityBranch: Vector<Bytes32>;
  /** Sync committee aggregate signature */
  syncCommitteeBits: BitVector;
  syncCommitteeSignature: BLSSignature;
  /** Fork version for the aggregate signature */
  forkVersion: Version;
}

/**
 * Spec v1.0.1
 */
export interface LightClientStore {
  snapshot: LightClientSnapshot;
  validUpdates: List<LightClientUpdate>;
}
