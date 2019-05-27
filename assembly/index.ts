import "allocator/arena"
export {memory};

type Root = string;
type Gwei = u64;
type Slot = u32;

export class Node {
  public slot: Slot;
  public blockRoot: Root;
  public weight: Gwei;
  public parent: Node;
  public bestChild: Node | null;
  public bestTarget: Node | null;
  public children: Map<Root, Node> | null = null;
  public childValues: Node[];

  public constructor(slot: Slot, blockRoot: Root, parent: Node) {
    this.slot = slot;
    this.blockRoot = blockRoot;
    this.parent = parent;

    this.weight = 0;
    this.bestChild = null;
    this.bestTarget = null;
    this.children = new Map();
  }

  public equals(other: Node): boolean {
    return this.blockRoot === other.blockRoot;
  }

  public betterThan(other: Node): boolean {
    return (
      this.weight > other.weight ||
      (this.weight === other.weight && this.blockRoot > other.blockRoot)
    );
  }

  public addChild(child: Node): void {
    this.children.set(child.blockRoot, child);
    this.childValues.push(child);
    if (this.children.size === 1) {
      this.bestChild = child;
      let c: Node = child;
      let p: Node = this;
      while (p) {
        if (c === p.bestChild) {
          p.bestTarget = child.bestTarget;
          c = p;
          p = p.parent;
        } else {
          break;
        }
      }
    }
  }

  public propogateWeightChange(delta: Gwei): void {
    this.weight += delta;
    if (this.parent) {
      if (delta <= 0) {
        this.onRemoveWeight();
      } else {
        this.parent.propogateWeightChange(delta);
      }
    }
  }

  private onAddWeight(): void {
    if (this.equals((this.parent.bestChild)) || this.betterThan(this.parent.bestChild)) {
      this.parent.bestChild = this;
      this.parent.bestTarget = this.bestTarget;
    }
  }

  private onRemoveWeight(): void {
    if (this.equals(this.parent.bestChild)) {
      this.childValues.reduce((a, b) => b.betterThan((a) ? b : a, this));
    }
  }
}
