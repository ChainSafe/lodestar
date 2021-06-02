import {BitList, Vector} from "@chainsafe/ssz";

import * as phase0 from "../../phase0/types";

export interface SyncCommittee {
  pubkeys: Vector<phase0.BLSPubkey>;
  aggregatePubkey: phase0.BLSPubkey;
}

export interface SyncCommitteeSignature {
  slot: phase0.Slot;
  beaconBlockRoot: phase0.Root;
  validatorIndex: phase0.ValidatorIndex;
  signature: phase0.BLSSignature;
}

export interface SyncCommitteeContribution {
  slot: phase0.Slot;
  beaconBlockRoot: phase0.Root;
  subCommitteeIndex: phase0.SubCommitteeIndex;
  aggregationBits: BitList;
  signature: phase0.BLSSignature;
}

export interface ContributionAndProof {
  aggregatorIndex: phase0.ValidatorIndex;
  contribution: SyncCommitteeContribution;
  selectionProof: phase0.BLSSignature;
}

export interface SignedContributionAndProof {
  message: ContributionAndProof;
  signature: phase0.BLSSignature;
}

export interface SyncAggregatorSelectionData {
  slot: phase0.Slot;
  subCommitteeIndex: phase0.SubCommitteeIndex;
}
