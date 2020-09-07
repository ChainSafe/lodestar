import {toHexString} from "@chainsafe/ssz";
import {Checkpoint, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ITreeStateContext} from "./stateContextCache";

/**
 * In memory cache of BeaconState and connected EpochContext
 * belonging to checkpoint
 *
 * Similar API to Repository
 */
export class CheckpointStateContextCache {
  private readonly config: IBeaconConfig;
  private cache: Record<string, ITreeStateContext>;
  private epochIndex: Record<Epoch, string[]>;

  constructor(config: IBeaconConfig) {
    this.config = config;
    this.cache = {};
    this.epochIndex = {};
  }

  public async get(cp: Checkpoint): Promise<ITreeStateContext | null> {
    const item = this.cache[toHexString(this.config.types.Checkpoint.hashTreeRoot(cp))];
    if (!item) {
      return null;
    }
    return this.clone(item);
  }

  public async add(cp: Checkpoint, item: ITreeStateContext): Promise<void> {
    const key = toHexString(this.config.types.Checkpoint.hashTreeRoot(cp));
    if (this.cache[key]) {
      return;
    }
    this.cache[key] = this.clone(item);
    if (this.epochIndex[cp.epoch]) {
      this.epochIndex[cp.epoch].push(key);
    } else {
      this.epochIndex[cp.epoch] = [key];
    }
  }

  public async delete(cp: Checkpoint): Promise<void> {
    const key = this.config.types.Checkpoint.hashTreeRoot(cp);
    delete this.cache[toHexString(key)];
  }

  public async deleteAllEpochItems(epoch: Epoch): Promise<void> {
    this.epochIndex[epoch]?.forEach((key) => {
      delete this.cache[key];
    });
    delete this.epochIndex[epoch];
  }

  public clear(): void {
    this.cache = {};
    this.epochIndex = {};
  }

  private clone(item: ITreeStateContext): ITreeStateContext {
    return {
      state: item.state.clone(),
      epochCtx: item.epochCtx.copy(),
    };
  }
}
