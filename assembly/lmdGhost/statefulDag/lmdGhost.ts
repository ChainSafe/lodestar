export {memory};
import {AggregatedAttestation, AttestationAggregator} from "./attestationAggregator";
import {bytes32, Root, Gwei, Slot, ValidatorIndex} from "../../types";

export class Node {
  public slot: Slot;
  public blockRoot: Root;
  public weight: Gwei;
  public parent: Node | null;
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
    var bestChild = <Node>this.parent.bestChild;
    if (this.equals((bestChild)) || this.betterThan(bestChild)) {
      this.parent.bestChild = this;
      this.parent.bestTarget = this.bestTarget;
    }
  }

  private onRemoveWeight(): void {
    var bestChild = <Node>this.parent.bestChild;
    if (this.equals(bestChild)) {
      let newBest: Node = this.childValues.reduce<Node>((a: Node, b: Node) => b.betterThan(a) ? b : a, this);
      if (!this.equals(newBest)){
        this.parent.bestChild = newBest;
        this.parent.bestTarget = newBest.bestTarget;
      }
    }
  }
}

export class StatefulDagLMDGHOST {
  private aggregator: AttestationAggregator;
  private nodes: Map<Root, Node>;
  private finalized: Node;
  private justified: Node;
  private synced: boolean;

  public constructor() {
    this.aggregator =
      new AttestationAggregator((hex) => this.nodes.get(hex) ? this.nodes.get(hex).slot : null);
    this.nodes = new Map();
    this.finalized = <Node>{};
    this.justified = <Node>{};
    this.synced = true;
  }

  public addBlock(slot: Slot, blockRootBuf: bytes32, parentRootBuf: bytes32): void {
    this.synced = false;
    const blockRoot = blockRootBuf.toString('hex');
    const parentRoot = parentRootBuf.toString('hex');
    const parentBlock = this.nodes.get(parentRoot);

    // Ensure blockRoot exists
    const node: Node = this.nodes.get(blockRoot) || new Node(
      slot,
      blockRoot,
      parentBlock
    );
    //best target is the node itself
    node.bestTarget = node;
    this.nodes.set(blockRoot, node);

    // If parent root exists, link to blockRoot
    if (parentBlock) {
      parentBlock.addChild(node);
    }
  }

  public addAttestation(blockRootBuf: bytes32, attester: ValidatorIndex, weight: Gwei): void {
    this.synced = false;
    this.aggregator.addAttestation({
      target: blockRootBuf.toString('hex'),
      attester,
      weight
    });
  }

  public setFinalized(blockRoot: bytes32): void {
    this.synced = false;
    const rootHex: string = blockRoot.toString('hex');
    this.finalized = this.nodes.get(rootHex);
    this.prune();
    this.aggregator.prune();
  }

  public setJustified(blockRoot: bytes32): void {
    const rootHex = blockRoot.toString('hex');
    this.justified = this.nodes.get(rootHex);
  }

  public prune(): void {
    if (this.finalized) {
      const keys: string[] = this.nodes.keys();
      const values: Node[] = this.nodes.values();
      for (let i: number = 0; i < this.nodes.size; i++) {
        if (values[i].slot < this.finalized.slot) {
          this.nodes.delete(keys[i]);
        }
      }
      this.finalized.parent = null;
    }
  }

  public syncChanges(): void {
    const keys: string[] = this.aggregator.latestAggregates.keys();
    const values: AggregatedAttestation[] = this.aggregator.latestAggregates.values();
    for (let i: u16 = 0; i < keys.length; i++) {
      const agg: AggregatedAttestation = values[i];
      if (agg.prevWeight !== agg.weight) {
        const delta = agg.weight - agg.prevWeight;
        this.nodes.get(agg.target).propogateWeightChange(delta);
      }
    }
    this.synced = true;
  }

  public head(): bytes32 {
    assert(this.justified);
    if (!this.synced) {
      this.syncChanges();
    }
    return Uint8Array.from(this.justified.bestTarget.blockRoot);
  }
}
