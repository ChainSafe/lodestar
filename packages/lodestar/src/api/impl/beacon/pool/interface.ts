import {
  Attestation,
  AttesterSlashing,
  CommitteeIndex,
  ProposerSlashing,
  SignedVoluntaryExit,
  Slot,
} from "@chainsafe/lodestar-types";

export interface IAttestationFilters {
  slot: Slot;
  committeeIndex: CommitteeIndex;
}

export interface IBeaconPoolApi {
  getAttestations(filters?: Partial<IAttestationFilters>): Promise<Attestation[]>;
  submitAttestation(attestation: Attestation): Promise<void>;
  getAttesterSlashings(): Promise<AttesterSlashing[]>;
  submitAttesterSlashing(slashing: AttesterSlashing): Promise<void>;
  getProposerSlashings(): Promise<ProposerSlashing[]>;
  submitProposerSlashing(slashing: ProposerSlashing): Promise<void>;
  getVoluntaryExits(): Promise<SignedVoluntaryExit[]>;
  submitVoluntaryExit(exit: SignedVoluntaryExit): Promise<void>;
}
