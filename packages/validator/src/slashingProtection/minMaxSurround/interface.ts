import {BLSPubkey, Epoch} from "@lodestar/types";

export type MinMaxSurroundAttestation = {
  targetEpoch: number;
  sourceEpoch: number;
};

export interface IMinMaxSurround {
  assertNoSurround(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void>;
  insertAttestation(pubKey: BLSPubkey, attestation: MinMaxSurroundAttestation): Promise<void>;
}

export type DistanceEntry = {
  source: Epoch;
  distance: Epoch;
};

export type IDistanceStore = {
  [P in "minSpan" | "maxSpan"]: {
    get(pubKey: BLSPubkey, epoch: Epoch): Promise<Epoch | null>;
    setBatch(pubKey: BLSPubkey, values: DistanceEntry[]): Promise<void>;
  };
};
