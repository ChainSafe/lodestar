import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Height = ValueOf<typeof ssz.Height>;
export type Round = ValueOf<typeof ssz.Round>;
export type AttestationCommittee = ValueOf<typeof ssz.AttestationCommittee>;
export type AttestationCommitteeBits = ValueOf<typeof ssz.AttestationCommitteeBits>;
export type HeadVoteCommittee = ValueOf<typeof ssz.HeadVoteCommittee>;
export type HeadVoteCommitteeBits = ValueOf<typeof ssz.HeadVoteCommitteeBits>;
export type HeadVoteParticipation = ValueOf<typeof ssz.HeadVoteParticipation>;
export type HeadVoteSupportBits = ValueOf<typeof ssz.HeadVoteSupportBits>;
export type HeightParticipation = ValueOf<typeof ssz.HeightParticipation>;
export type RoundParticipation = ValueOf<typeof ssz.RoundParticipation>;

export type HeightCheckpoint = ValueOf<typeof ssz.HeightCheckpoint>;
export type HeightCheckpointBigint = ValueOf<typeof ssz.HeightCheckpointBigint>;
export type PendingFinality = ValueOf<typeof ssz.PendingFinality>;
export type PendingFinalities = ValueOf<typeof ssz.PendingFinalities>;
export type HeadVoteData = ValueOf<typeof ssz.HeadVoteData>;
export type HeadVote = ValueOf<typeof ssz.HeadVote>;
export type HeadVotes = ValueOf<typeof ssz.HeadVotes>;
export type HeadVoteMessage = ValueOf<typeof ssz.HeadVoteMessage>;
export type AttestationData = ValueOf<typeof ssz.AttestationData>;
export type AttestationDataBigint = ValueOf<typeof ssz.AttestationDataBigint>;
export type SingleAttestation = ValueOf<typeof ssz.SingleAttestation>;
export type Attestation = ValueOf<typeof ssz.Attestation>;
export type Attestations = ValueOf<typeof ssz.Attestations>;
export type IndexedAttestation = ValueOf<typeof ssz.IndexedAttestation>;
export type IndexedAttestationBigint = ValueOf<typeof ssz.IndexedAttestationBigint>;
export type AttesterSlashing = ValueOf<typeof ssz.AttesterSlashing>;
export type LegacyAttesterSlashings = ValueOf<typeof ssz.LegacyAttesterSlashings>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BlockContents = ValueOf<typeof ssz.BlockContents>;
export type SignedBlockContents = {signedBlock: SignedBeaconBlock};
export type BeaconState = ValueOf<typeof ssz.BeaconState>;
