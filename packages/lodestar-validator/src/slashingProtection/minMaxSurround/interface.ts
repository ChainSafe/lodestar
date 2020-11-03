import {BLSPubkey, Epoch} from "@chainsafe/lodestar-types";

export type Att = {
  target: number;
  source: number;
};

export interface IMinMaxSurround {
  assertNoSurround(pubKey: BLSPubkey, att: Att): Promise<void>;
  insertAttestation(pubKey: BLSPubkey, att: Att): Promise<void>;
}

export interface IDistanceEntry {
  source: Epoch;
  distance: Epoch;
}

export type IDistanceStore = {
  [P in "minSpan" | "maxSpan"]: {
    get(pubKey: BLSPubkey, epoch: Epoch): Promise<Epoch | null>;
    setBatch(pubKey: BLSPubkey, values: IDistanceEntry[]): Promise<void>;
  };
};
