import {BasicListType, List, TreeBacked} from "@chainsafe/ssz";
import {Number64} from "@chainsafe/lodestar-types";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {MutableVector} from "@chainsafe/persistent-ts";

/**
 * Inactivity score implementation that synchronizes changes between two underlying implementations:
 *   an immutable-js-style backing and a merkle tree backing
 */
export class CachedInactivityScoreList implements List<Number64> {
  [index: number]: Number64;
  tree: Tree;
  type: BasicListType<List<Number64>>;
  persistent: MutableVector<Number64>;

  constructor(type: BasicListType<List<Number64>>, tree: Tree, persistent: MutableVector<Number64>) {
    this.type = type;
    this.tree = tree;
    this.persistent = persistent;
  }

  get length(): number {
    return this.persistent.length;
  }

  get(index: number): Number64 | undefined {
    return this.persistent.get(index) ?? undefined;
  }

  set(index: number, value: Number64): void {
    this.persistent.set(index, value);
    this.type.tree_setProperty(this.tree, index, value);
  }

  setMultiple(newValues: Map<number, Number64>): void {
    // TODO: based on newValues.size to determine we build the tree from scratch or not
    for (const [index, value] of newValues.entries()) {
      this.set(index, value);
    }
  }

  push(value: Number64): number {
    this.persistent.push(value);
    return this.type.tree_push(this.tree, value);
  }

  pop(): Number64 {
    this.type.tree_pop(this.tree);
    return this.persistent.pop() as Number64;
  }

  *[Symbol.iterator](): Iterator<Number64> {
    yield* this.persistent[Symbol.iterator]();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(fn: (value: Number64, index: number, list: this) => boolean): Number64 | undefined {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findIndex(fn: (value: Number64, index: number, list: this) => boolean): number {
    return -1;
  }

  forEach(fn: (value: Number64, index: number, list: this) => void): void {
    this.persistent.forEach(fn as (value: Number64, index: number) => void);
  }

  map<T>(fn: (value: Number64, index: number) => T): T[] {
    return this.persistent.map(fn);
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedInactivityScoreListProxyHandler: ProxyHandler<CachedInactivityScoreList> = {
  get(target: CachedInactivityScoreList, key: PropertyKey): unknown {
    if (!Number.isNaN(Number(String(key)))) {
      return target.get(key as number);
    } else if (target[key as keyof CachedInactivityScoreList] !== undefined) {
      return target[key as keyof CachedInactivityScoreList];
    } else {
      const treeBacked = target.type.createTreeBacked(target.tree);
      if (key in treeBacked) {
        return treeBacked[key as keyof TreeBacked<List<Number64>>];
      }
      return undefined;
    }
  },
  set(target: CachedInactivityScoreList, key: PropertyKey, value: Number64): boolean {
    if (!Number.isNaN(Number(key))) {
      target.set(key as number, value);
      return true;
    }
    return false;
  },
};
