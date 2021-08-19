import {BasicListType, List, TreeBacked} from "@chainsafe/ssz";
import {Tree} from "@chainsafe/persistent-merkle-tree";

/**
 * Balances registry that synchronizes changes between two underlying implementations:
 *   an immutable-js-style backing and a merkle tree backing
 */
export class CachedBalanceList implements List<number> {
  [index: number]: number;
  tree: Tree;
  type: BasicListType<List<number>>;

  constructor(type: BasicListType<List<number>>, tree: Tree) {
    this.type = type;
    this.tree = tree;
  }

  get length(): number {
    return this.type.tree_getLength(this.tree);
  }

  get(index: number): number | undefined {
    return this.type.tree_getProperty(this.tree, index) as number | undefined;
  }

  set(index: number, value: number): void {
    this.type.tree_setProperty(this.tree, index, value);
  }

  updateDelta(index: number, delta: number): number {
    return this.type.tree_applyUint64Delta(this.tree, index, delta);
  }

  /** Return the new balances */
  updateAll(deltas: number[]): number[] {
    const [node, newBalances] = this.type.tree_newTreeFromUint64Deltas(this.tree, deltas);
    this.tree.rootNode = node;
    this.type.tree_setLength(this.tree, newBalances.length);
    return newBalances;
  }

  push(value: number): number {
    return this.type.tree_push(this.tree, value);
  }

  pop(): number {
    return this.type.tree_pop(this.tree);
  }

  *[Symbol.iterator](): Iterator<number> {
    for (let i = 0; i < this.length; i++) {
      yield this.get(i) as number;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(fn: (value: number, index: number, list: this) => boolean): number | undefined {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  findIndex(fn: (value: number, index: number, list: this) => boolean): number {
    return -1;
  }
}

// TODO: remove the proxy as we don't have a persistent-ts array anymore
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
        return treeBacked[key as keyof TreeBacked<List<number>>];
      }
      return undefined;
    }
  },
  set(target: CachedBalanceList, key: PropertyKey, value: number): boolean {
    if (!Number.isNaN(Number(key))) {
      target.set(key as number, value);
      return true;
    }
    return false;
  },
};
