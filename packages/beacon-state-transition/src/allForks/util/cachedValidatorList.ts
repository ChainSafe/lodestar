import {CompositeListType, isTreeBacked, List, TreeBacked} from "@chainsafe/ssz";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {MutableVector} from "@chainsafe/persistent-ts";
import {createValidatorFlat, ValidatorFlat} from "./flat";

/**
 * Validator registry that synchronizes changes between two underlying implementations:
 *   an immutable-js-style backing and a merkle tree backing
 */
export class CachedValidatorList implements List<ValidatorFlat> {
  [index: number]: ValidatorFlat;
  tree: Tree;
  type: CompositeListType<List<ValidatorFlat>>;
  persistent: MutableVector<ValidatorFlat>;

  constructor(type: CompositeListType<List<ValidatorFlat>>, tree: Tree, persistent: MutableVector<ValidatorFlat>) {
    this.type = type;
    this.tree = tree;
    this.persistent = persistent;
  }

  get length(): number {
    return this.persistent.length;
  }

  get(index: number): ValidatorFlat | undefined {
    return this.persistent.get(index) ?? undefined;
  }

  set(index: number, value: ValidatorFlat): void {
    this.persistent.set(index, createValidatorFlat(value) as ValidatorFlat);
    this.type.tree_setProperty(this.tree, index, this.type.elementType.struct_convertToTree(value));
  }

  update(index: number, value: Partial<ValidatorFlat>): void {
    const fullValue = this.persistent.update(index, value);
    this.type.tree_setProperty(this.tree, index, this.type.elementType.struct_convertToTree(fullValue));
  }

  push(value: ValidatorFlat): number {
    const flat = isTreeBacked(value) ? (createValidatorFlat(value) as ValidatorFlat) : value;
    this.persistent.push(flat);
    return this.type.tree_push(this.tree, this.type.elementType.struct_convertToTree(value));
  }

  pop(): ValidatorFlat {
    this.type.tree_pop(this.tree);
    return this.persistent.pop() as ValidatorFlat;
  }

  *[Symbol.iterator](): Iterator<ValidatorFlat> {
    yield* this.persistent[Symbol.iterator]();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(fn: (value: ValidatorFlat, index: number, list: this) => boolean): ValidatorFlat | undefined {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findIndex(fn: (value: ValidatorFlat, index: number, list: this) => boolean): number {
    return -1;
  }

  forEach(fn: (value: ValidatorFlat, index: number, list: this) => void): void {
    this.persistent.forEach(fn as (value: ValidatorFlat, index: number) => void);
  }

  map<T2>(fn: (value: ValidatorFlat, index: number) => T2): T2[] {
    return this.persistent.map(fn);
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedValidatorListProxyHandler: ProxyHandler<CachedValidatorList> = {
  get(target: CachedValidatorList, key: PropertyKey): unknown {
    if (!Number.isNaN(Number(String(key)))) {
      return target.get(key as number);
    } else if (target[key as keyof CachedValidatorList]) {
      return target[key as keyof CachedValidatorList];
    } else {
      const treeBacked = target.type.createTreeBacked(target.tree);
      if (key in treeBacked) {
        return treeBacked[key as keyof TreeBacked<List<ValidatorFlat>>];
      }
      return undefined;
    }
  },
  set(target: CachedValidatorList, key: PropertyKey, value: ValidatorFlat): boolean {
    if (!Number.isNaN(Number(key))) {
      target.set(key as number, value);
      return true;
    }
    return false;
  },
};
