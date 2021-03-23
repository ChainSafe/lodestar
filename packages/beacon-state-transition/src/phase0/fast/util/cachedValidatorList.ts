import {CompositeListTreeHandler, CompositeListType, List, TreeBacked} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {MutableVector} from "@chainsafe/persistent-ts";
import {createFlat} from "./flat";

/**
 * Validator registry that synchronizes changes between two underlying implementations:
 *   an immutable-js-style backing and a merkle tree backing
 */
export class CachedValidatorList<T extends phase0.Validator> implements List<T> {
  [index: number]: T;
  tree: Tree;
  type: CompositeListType<List<T>>;
  persistent: MutableVector<T>;

  constructor(treeBacked: TreeBacked<List<T>>, persistent: MutableVector<T>) {
    this.tree = treeBacked.tree();
    this.type = treeBacked.type() as CompositeListType<List<T>>;
    this.persistent = persistent;
  }

  get length(): number {
    return this.persistent.length;
  }

  get(index: number): T | undefined {
    return this.persistent.get(index) ?? undefined;
  }

  set(index: number, value: T): void {
    this.persistent.set(index, createFlat(value));
    this.type.tree.set(this.tree, index, value);
  }

  update(index: number, value: Partial<T>): void {
    const fullValue = this.persistent.update(index, value);
    this.type.tree.set(this.tree, index, fullValue);
  }

  push(value: T): number {
    this.persistent.push(createFlat(value));
    return (this.type.tree as CompositeListTreeHandler<List<T>>).push(this.tree, value);
  }

  pop(): T {
    (this.type.tree as CompositeListTreeHandler<List<T>>).pop(this.tree);
    return this.persistent.pop() as T;
  }

  *[Symbol.iterator](): Iterator<T> {
    yield* this.persistent[Symbol.iterator]();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(fn: (value: T, index: number, list: this) => boolean): T | undefined {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findIndex(fn: (value: T, index: number, list: this) => boolean): number {
    return -1;
  }

  forEach(fn: (value: T, index: number, list: this) => void): void {
    this.persistent.forEach(fn as (value: T, index: number) => void);
  }

  map<T2>(fn: (value: T, index: number) => T2): T2[] {
    return this.persistent.map(fn);
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedValidatorListProxyHandler: ProxyHandler<CachedValidatorList<phase0.Validator>> = {
  get(target: CachedValidatorList<phase0.Validator>, key: PropertyKey): unknown {
    if (!Number.isNaN(Number(key))) {
      return target.get(key as number);
    } else if (target[key as keyof CachedValidatorList<phase0.Validator>]) {
      return target[key as keyof CachedValidatorList<phase0.Validator>];
    } else {
      return target.type.tree.get(target.tree, key);
    }
  },
  set(target: CachedValidatorList<phase0.Validator>, key: PropertyKey, value: phase0.Validator): boolean {
    if (!Number.isNaN(Number(key))) {
      target.set(key as number, value);
      return true;
    }
    return false;
  },
};
