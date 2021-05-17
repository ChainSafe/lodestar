import {altair, CommitteeIndex, phase0, Slot} from "@chainsafe/lodestar-types";

export interface IAttestationFilters {
  slot: Slot;
  committeeIndex: CommitteeIndex;
}

export interface IBeaconPoolApi {
  getAttestations(filters?: Partial<IAttestationFilters>): Promise<phase0.Attestation[]>;
  getAttesterSlashings(): Promise<phase0.AttesterSlashing[]>;
  getProposerSlashings(): Promise<phase0.ProposerSlashing[]>;
  getVoluntaryExits(): Promise<phase0.SignedVoluntaryExit[]>;
  submitAttestations(attestations: phase0.Attestation[]): Promise<void>;
  submitAttesterSlashing(slashing: phase0.AttesterSlashing): Promise<void>;
  submitProposerSlashing(slashing: phase0.ProposerSlashing): Promise<void>;
  submitVoluntaryExit(exit: phase0.SignedVoluntaryExit): Promise<void>;
  submitSyncCommitteeSignatures(signatures: altair.SyncCommitteeSignature[]): Promise<void>;
}
