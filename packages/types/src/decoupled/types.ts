import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type Height = ValueOf<typeof ssz.Height>;
export type Round = ValueOf<typeof ssz.Round>;
export type PayloadStatus = ValueOf<typeof ssz.PayloadStatus>;
export type HeightPair = ValueOf<typeof ssz.HeightPair>;
export type AttestationData2 = ValueOf<typeof ssz.AttestationData2>;
export type IndexedAttestation2 = ValueOf<typeof ssz.IndexedAttestation2>;
export type AttesterSlashing2 = ValueOf<typeof ssz.AttesterSlashing2>;
export type AvailableChainAttestationData = ValueOf<typeof ssz.AvailableChainAttestationData>;
export type AvailableChainAttestation = ValueOf<typeof ssz.AvailableChainAttestation>;
export type AvailableChainCommittee = ValueOf<typeof ssz.AvailableChainCommittee>;
export type AvailableChainCommitteeIndices = ValueOf<typeof ssz.AvailableChainCommitteeIndices>;
export type AvailableChainParticipation = ValueOf<typeof ssz.AvailableChainParticipation>;
export type CommitteeBits = ValueOf<typeof ssz.CommitteeBits>;
export type Attestation = ValueOf<typeof ssz.Attestation>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;
export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type BlockContents = ValueOf<typeof ssz.BlockContents>;
