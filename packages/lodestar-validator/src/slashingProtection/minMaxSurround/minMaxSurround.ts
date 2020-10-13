import {IMinMaxSurround, IDistanceEntry, IDistanceStore, Att} from "./interface";
import {SurroundAttestationError, SurroundAttestationErrorCode} from "./errors";

// surround vote checking with min-max surround
// https://github.com/protolambda/eth2-surround#min-max-surround

export class MinMaxSurround implements IMinMaxSurround {
  private store: IDistanceStore;
  private maxEpochLookback: number;

  constructor({store, maxEpochLookback}: {store: IDistanceStore; maxEpochLookback?: number}) {
    this.store = store;
    this.maxEpochLookback = maxEpochLookback || Infinity;
  }

  async check(att: Att): Promise<void> {
    await this.assertNotSurrounding(att);
    await this.assertNotSurrounded(att);
  }

  async checkAndInsert(att: Att): Promise<void> {
    await this.updateMinSpan(att);
    await this.updateMaxSpan(att);
  }

  // min span

  private async updateMinSpan({target, source}: Att): Promise<void> {
    await this.assertNotSurrounding({target, source});

    const untilEpoch = Math.max(0, source - 1 - this.maxEpochLookback);

    const values: IDistanceEntry[] = [];
    for (let epoch = source - 1; epoch >= untilEpoch; epoch--) {
      const minSpan = await this.store.minSpan.get(epoch);
      const distance = target - epoch;
      if (!minSpan || distance < minSpan) {
        values.push({source: epoch, distance});
      } else {
        break;
      }
    }
    await this.store.minSpan.setBatch(values);
  }

  private async assertNotSurrounding({target, source}: Att): Promise<void> {
    const minSpan = await this.store.minSpan.get(source);
    const distance = target - source;
    if (minSpan != null && minSpan > 0 && minSpan < distance) {
      throw new SurroundAttestationError({
        code: SurroundAttestationErrorCode.IS_SURROUNDING,
        att: {target, source},
        att2Target: source + minSpan,
      });
    }
  }

  // max span

  private async updateMaxSpan({target, source}: Att): Promise<void> {
    await this.assertNotSurrounded({target, source});

    const values: IDistanceEntry[] = [];
    for (let epoch = source + 1; epoch < target; epoch++) {
      const maxSpan = await this.store.maxSpan.get(epoch);
      const distance = target - epoch;
      if (!maxSpan || distance > maxSpan) {
        values.push({source: epoch, distance});
      } else {
        break;
      }
    }
    await this.store.maxSpan.setBatch(values);
  }

  private async assertNotSurrounded({target, source}: Att): Promise<void> {
    const maxSpan = await this.store.maxSpan.get(source);
    const distance = target - source;
    if (maxSpan != null && maxSpan > 0 && maxSpan > distance) {
      throw new SurroundAttestationError({
        code: SurroundAttestationErrorCode.IS_SURROUNDED,
        att: {target, source},
        att2Target: source + maxSpan,
      });
    }
  }
}
