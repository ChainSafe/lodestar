import {BasicListType, List, TreeBacked} from "@chainsafe/ssz";
import {Gwei} from "@chainsafe/lodestar-types";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {MutableVector, Vector} from "@chainsafe/persistent-ts";
import {unsafeUint8ArrayToTree} from "./unsafeUint8ArrayToTree";

/**
 * Balances registry that synchronizes changes between two underlying implementations:
 *   an immutable-js-style backing and a merkle tree backing
 */
export class CachedBalanceList implements List<Gwei> {
  [index: number]: Gwei;
  tree: Tree;
  type: BasicListType<List<Gwei>>;
  persistent: MutableVector<Gwei>;

  constructor(type: BasicListType<List<Gwei>>, tree: Tree, persistent: MutableVector<Gwei>) {
    this.type = type;
    this.tree = tree;
    this.persistent = persistent;
  }

  get length(): number {
    return this.persistent.length;
  }

  get(index: number): Gwei | undefined {
    return this.persistent.get(index) ?? undefined;
  }

  set(index: number, value: Gwei): void {
    this.persistent.set(index, value);
    this.type.tree_setProperty(this.tree, index, value);
  }

  updateAll(balances: BigUint64Array): void {
    this.persistent.vector = Vector.from(balances);
    this.tree.rootNode = unsafeUint8ArrayToTree(
      new Uint8Array(balances.buffer, balances.byteOffset, balances.byteLength),
      this.type.getChunkDepth()
    );
    this.type.tree_setLength(this.tree, balances.length);
  }

  push(value: Gwei): number {
    this.persistent.push(value);
    return this.type.tree_push(this.tree, value);
  }

  pop(): Gwei {
    this.type.tree_pop(this.tree);
    return this.persistent.pop() as Gwei;
  }

  *[Symbol.iterator](): Iterator<Gwei> {
    yield* this.persistent[Symbol.iterator]();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(fn: (value: Gwei, index: number, list: this) => boolean): Gwei | undefined {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findIndex(fn: (value: Gwei, index: number, list: this) => boolean): number {
    return -1;
  }

  forEach(fn: (value: Gwei, index: number, list: this) => void): void {
    this.persistent.forEach(fn as (value: Gwei, index: number) => void);
  }

  map<T>(fn: (value: Gwei, index: number) => T): T[] {
    return this.persistent.map(fn);
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedBalanceListProxyHandler: ProxyHandler<CachedBalanceList> = {
  get(target: CachedBalanceList, key: PropertyKey): unknown {
    if (!Number.isNaN(Number(String(key)))) {
      return target.get(key as number);
    } else if (target[key as keyof CachedBalanceList]) {
      return target[key as keyof CachedBalanceList];
    } else {
      const treeBacked = target.type.createTreeBacked(target.tree);
      if (key in treeBacked) {
        return treeBacked[key as keyof TreeBacked<List<Gwei>>];
      }
      return undefined;
    }
  },
  set(target: CachedBalanceList, key: PropertyKey, value: Gwei): boolean {
    if (!Number.isNaN(Number(key))) {
      target.set(key as number, value);
      return true;
    }
    return false;
  },
};
