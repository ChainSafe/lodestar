import {List, Number64ListType, TreeBacked} from "@chainsafe/ssz";
import {Tree} from "@chainsafe/persistent-merkle-tree";

/**
 * Manage balances of BeaconState.
 */
export class BalanceList implements List<number> {
  [index: number]: number;
  tree: Tree;
  type: Number64ListType;

  constructor(type: Number64ListType, tree: Tree) {
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

  applyDelta(index: number, delta: number): number {
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

// eslint-disable-next-line @typescript-eslint/naming-convention
export const CachedBalanceListProxyHandler: ProxyHandler<BalanceList> = {
  get(target: BalanceList, key: PropertyKey): unknown {
    if (!Number.isNaN(Number(String(key)))) {
      return target.get(key as number);
    } else if (target[key as keyof BalanceList]) {
      return target[key as keyof BalanceList];
    } else {
      const treeBacked = target.type.createTreeBacked(target.tree);
      if (key in treeBacked) {
        return treeBacked[key as keyof TreeBacked<List<number>>];
      }
      return undefined;
    }
  },
  set(target: BalanceList, key: PropertyKey, value: number): boolean {
    if (!Number.isNaN(Number(key))) {
      target.set(key as number, value);
      return true;
    }
    return false;
  },
};
