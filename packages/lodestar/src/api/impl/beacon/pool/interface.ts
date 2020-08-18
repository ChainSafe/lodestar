import {Attestation, CommitteeIndex, Slot} from "@chainsafe/lodestar-types";

export interface IAttestationFilters {
  slot: Slot;
  committeeIndex: CommitteeIndex;
}

export interface IBeaconPoolApi {
  getAttestations(filters?: Partial<IAttestationFilters>): Promise<Attestation[]>;
}

