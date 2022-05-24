import {BLSPubkey, ssz} from "@chainsafe/lodestar-types";
import {IDistanceStore, IDistanceEntry} from "../../../../src/slashingProtection/minMaxSurround/index.js";

export const emptyPubkey = ssz.BLSPubkey.defaultValue();
export class DistanceMapStore {
  map: Map<number, number>;
  constructor() {
    this.map = new Map<number, number>();
  }

  async get(pubkey: BLSPubkey, epoch: number): Promise<number | null> {
    return this.map.get(epoch) ?? null;
  }

  async setBatch(pubkey: BLSPubkey, values: IDistanceEntry[]): Promise<void> {
    for (const {source, distance} of values) {
      this.map.set(source, distance);
    }
  }
}

export class DistanceStoreMemory implements IDistanceStore {
  minSpan: DistanceMapStore;
  maxSpan: DistanceMapStore;

  constructor() {
    this.minSpan = new DistanceMapStore();
    this.maxSpan = new DistanceMapStore();
  }
}

export type SpansPerEpoch = {[source: number]: [number, number]};

export async function storeToSpansPerEpoch(store: DistanceStoreMemory): Promise<SpansPerEpoch> {
  const spansPerEpoch: SpansPerEpoch = {};
  const minSpanEpochs = Array.from(store.minSpan.map.keys());
  const maxSpanEpochs = Array.from(store.maxSpan.map.keys());
  const epochs = [...new Set([...minSpanEpochs, ...maxSpanEpochs])].sort();
  for (const epoch of epochs) {
    spansPerEpoch[epoch] = [
      (await store.minSpan.get(emptyPubkey, epoch)) ?? 0,
      (await store.maxSpan.get(emptyPubkey, epoch)) ?? 0,
    ];
  }
  return spansPerEpoch;
}
