import {CommitteeIndex, phase0, Slot} from "@chainsafe/lodestar-types";

export interface IAttestationFilters {
  slot: Slot;
  committeeIndex: CommitteeIndex;
}

export interface IBeaconPoolApi {
  getAttestations(filters?: Partial<IAttestationFilters>): Promise<phase0.Attestation[]>;
  submitAttestations(attestations: phase0.Attestation[]): Promise<void>;
  getAttesterSlashings(): Promise<phase0.AttesterSlashing[]>;
  submitAttesterSlashing(slashing: phase0.AttesterSlashing): Promise<void>;
  getProposerSlashings(): Promise<phase0.ProposerSlashing[]>;
  submitProposerSlashing(slashing: phase0.ProposerSlashing): Promise<void>;
  getVoluntaryExits(): Promise<phase0.SignedVoluntaryExit[]>;
  submitVoluntaryExit(exit: phase0.SignedVoluntaryExit): Promise<void>;
}
