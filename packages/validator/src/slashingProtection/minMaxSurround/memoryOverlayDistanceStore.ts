import {BLSPubkey, Epoch} from "@lodestar/types";
import {DistanceEntry, IDistanceStore} from "./interface.js";

export class MemoryOverlayDistanceStore implements IDistanceStore {
  minSpan: SpanDistanceOverlay;
  maxSpan: SpanDistanceOverlay;

  constructor(underlying: IDistanceStore) {
    this.minSpan = new SpanDistanceOverlay(underlying.minSpan);
    this.maxSpan = new SpanDistanceOverlay(underlying.maxSpan);
  }

  async commit(pubKey: BLSPubkey): Promise<void> {
    await this.minSpan.commit(pubKey);
    await this.maxSpan.commit(pubKey);
  }
}

class SpanDistanceOverlay {
  private staged = new Map<Epoch, Epoch>();

  constructor(
    private underlying: {
      get(pubKey: BLSPubkey, epoch: Epoch): Promise<Epoch | null>;
      setBatch(pubKey: BLSPubkey, values: DistanceEntry[]): Promise<void>;
    }
  ) {}

  async get(pubKey: BLSPubkey, epoch: Epoch): Promise<Epoch | null> {
    const stagedValue = this.staged.get(epoch);
    if (stagedValue !== undefined) {
      return stagedValue;
    }
    return this.underlying.get(pubKey, epoch);
  }

  async setBatch(_pubKey: BLSPubkey, values: DistanceEntry[]): Promise<void> {
    for (const {source, distance} of values) {
      this.staged.set(source, distance);
    }
  }

  async commit(pubKey: BLSPubkey): Promise<void> {
    if (this.staged.size === 0) {
      return;
    }
    const entries: DistanceEntry[] = [];
    for (const [source, distance] of this.staged.entries()) {
      entries.push({source, distance});
    }
    await this.underlying.setBatch(pubKey, entries);
    this.staged.clear();
  }
}
