import {AnySSZType} from "@chainsafe/ssz-type-schema";
import {CacheId, CacheIdFunction} from "./types";
import {clone, hashTreeRoot} from "@chainsafe/ssz";

export abstract class CacheItem<T> {

  protected sszType: AnySSZType;

  protected idFunction: CacheIdFunction<T>;

  protected cache: Map<CacheId, T> = new Map();

  protected constructor(sszType: AnySSZType, idFunction?: CacheIdFunction<T>) {
    this.sszType = sszType;
    this.idFunction = idFunction || this.hashRootIdFunction;
  }

  /**
     * It will return item matching id or null if item doesn't exists in cache
     * @param id optional, if not submitted,
     * first item in cache is returned (used in combination
     * where idFunction will always generate same id)
     */
  public get(id?: CacheId): T | null {
    const value = this.getOrFirst(id);
    if(value) {
      return clone(value, this.sszType);
    }
    return null;
  }

  public update(value: T, id?: CacheId): void {
    this.cache.set(
      this.idToString(id || this.idFunction(value, this.sszType)),
      clone(value, this.sszType)
    );
  }

  public clear(): void {
    this.cache.clear();
  }

  public delete(id?: CacheId): void {
    if(id) {
      this.cache.delete(this.idToString(id));
    } else {
      this.clear();
    }
  }

  protected getOrFirst(id: CacheId): T | null {
    if(id) {
      return this.cache.get(this.idToString(id)) || null;
    }
    return (this.cache.values().next().value as T) || null;
  }

  protected hashRootIdFunction: CacheIdFunction<T> = (value, type) => {
    return hashTreeRoot(value, type);
  };

  protected idToString(id: CacheId): string {
    if(Buffer.isBuffer(id)) {
      return id.toString("hex");
    }
    return String(id);
  }
}