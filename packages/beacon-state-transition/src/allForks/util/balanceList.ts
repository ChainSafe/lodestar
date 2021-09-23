import {Number64ListType} from "@chainsafe/ssz";
import {Tree} from "@chainsafe/persistent-merkle-tree";

/**
 * Manage balances of BeaconState, use this instead of state.balances
 */
export class BalanceList {
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
    return this.type.tree_applyDeltaAtIndex(this.tree, index, delta);
  }

  applyDeltaInBatch(deltaByIndex: Map<number, number>): void {
    this.type.tree_applyDeltaInBatch(this.tree, deltaByIndex);
  }

  /** Return the new balances */
  updateAll(deltas: number[]): number[] {
    const [newTree, newBalances] = this.type.tree_newTreeFromDeltas(this.tree, deltas);
    this.tree.rootNode = newTree.rootNode;
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
