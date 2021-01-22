import {ValidatorIndex, Epoch} from "@chainsafe/lodestar-types";

/**
 * In memory cache of connected validators to this node.
 *
 * Similar API to Repository
 */
export class ActiveValidatorCache {
  // validator index and last accessed epoch
  private cache: Map<ValidatorIndex, Epoch>;

  constructor() {
    this.cache = new Map();
  }

  public async get(index: ValidatorIndex): Promise<{index: ValidatorIndex; epoch: Epoch} | null> {
    const epoch = this.cache.get(index);
    if (typeof epoch !== "number") return null;

    return {
      index,
      epoch: epoch as Epoch,
    };
  }

  public async add(index: ValidatorIndex, epoch: Epoch): Promise<void> {
    this.cache.set(index, epoch);
  }

  public async delete(index: ValidatorIndex): Promise<void> {
    this.cache.delete(index);
  }

  public async batchDelete(indexes: ValidatorIndex[] = []): Promise<void> {
    indexes.forEach((index) => this.delete(index));
  }

  public async values(): Promise<ValidatorIndex[]> {
    return Array.from(this.cache.keys());
  }

  public clear(): void {
    this.cache = new Map();
  }

  public async pruneFinalized(finalizedEpoch: Epoch): Promise<void> {
    const validatorsToDelete: ValidatorIndex[] = [];
    for (const [index, epoch] of this.cache) {
      if (epoch < finalizedEpoch) {
        validatorsToDelete.push(index);
      }
    }
    await this.batchDelete(validatorsToDelete);
  }
}
