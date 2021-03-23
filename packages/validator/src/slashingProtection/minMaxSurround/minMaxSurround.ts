import {BLSPubkey} from "@chainsafe/lodestar-types";
import {IMinMaxSurround, IDistanceEntry, IDistanceStore, Att} from "./interface";
import {SurroundAttestationError, SurroundAttestationErrorCode} from "./errors";

// surround vote checking with min-max surround
// https://github.com/protolambda/eth2-surround#min-max-surround

export class MinMaxSurround implements IMinMaxSurround {
  private store: IDistanceStore;
  private maxEpochLookback: number;

  constructor(store: IDistanceStore, options?: {maxEpochLookback?: number}) {
    this.store = store;
    this.maxEpochLookback = options?.maxEpochLookback || Infinity;
  }

  async assertNoSurround(pubKey: BLSPubkey, att: Att): Promise<void> {
    await this.assertNotSurrounding(pubKey, att);
    await this.assertNotSurrounded(pubKey, att);
  }

  async insertAttestation(pubKey: BLSPubkey, att: Att): Promise<void> {
    await this.updateMinSpan(pubKey, att);
    await this.updateMaxSpan(pubKey, att);
  }

  // min span

  private async updateMinSpan(pubKey: BLSPubkey, att: Att): Promise<void> {
    await this.assertNotSurrounding(pubKey, att);

    const untilEpoch = Math.max(0, att.source - 1 - this.maxEpochLookback);

    const values: IDistanceEntry[] = [];
    for (let epoch = att.source - 1; epoch >= untilEpoch; epoch--) {
      const minSpan = await this.store.minSpan.get(pubKey, epoch);
      const distance = att.target - epoch;
      if (!minSpan || distance < minSpan) {
        values.push({source: epoch, distance});
      } else {
        break;
      }
    }
    await this.store.minSpan.setBatch(pubKey, values);
  }

  private async assertNotSurrounding(pubKey: BLSPubkey, att: Att): Promise<void> {
    const minSpan = await this.store.minSpan.get(pubKey, att.source);
    const distance = att.target - att.source;
    if (minSpan != null && minSpan > 0 && minSpan < distance) {
      throw new SurroundAttestationError({
        code: SurroundAttestationErrorCode.IS_SURROUNDING,
        att,
        att2Target: att.source + minSpan,
      });
    }
  }

  // max span

  private async updateMaxSpan(pubKey: BLSPubkey, att: Att): Promise<void> {
    await this.assertNotSurrounded(pubKey, att);

    const values: IDistanceEntry[] = [];
    for (let epoch = att.source + 1; epoch < att.target; epoch++) {
      const maxSpan = await this.store.maxSpan.get(pubKey, epoch);
      const distance = att.target - epoch;
      if (!maxSpan || distance > maxSpan) {
        values.push({source: epoch, distance});
      } else {
        break;
      }
    }
    await this.store.maxSpan.setBatch(pubKey, values);
  }

  private async assertNotSurrounded(pubKey: BLSPubkey, att: Att): Promise<void> {
    const maxSpan = await this.store.maxSpan.get(pubKey, att.source);
    const distance = att.target - att.source;
    if (maxSpan != null && maxSpan > 0 && maxSpan > distance) {
      throw new SurroundAttestationError({
        code: SurroundAttestationErrorCode.IS_SURROUNDED,
        att,
        att2Target: att.source + maxSpan,
      });
    }
  }
}
