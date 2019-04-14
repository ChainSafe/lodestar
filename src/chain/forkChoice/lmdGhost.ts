import assert from "assert";
import BN from "bn.js";

import {
  bytes32,
  Gwei,
  Slot,
  ValidatorIndex,
} from "../../types";

import {
  AttestationAggregator,
  Root,
} from "./attestationAggregator";


/**
 * A block root with additional metadata required to form a DAG
 * with vote weights and best blocks stored as metadata
 */
class Node {
  // block data
  public slot: number;
  public blockRoot: Root;

  /**
   * Total weight for a block and its children
   */
  public weight: Gwei;

  /**
   * Parent node, the previous block
   */
  public parent: Node;

  /**
   * Child node with the most weight
   */
  public bestChild: Node;

  /**
   * Decendent node with the most weight
   */
  public bestTarget: Node;

  /**
   * All direct children
   */
  public children: Record<Root, Node>;

  public constructor({slot, blockRoot, parent}: {slot: Slot; blockRoot: Root; parent: Node}) {
    this.slot = slot;
    this.blockRoot = blockRoot;
    this.parent = parent;

    this.weight = new BN(0);
    this.bestChild = null;
    this.bestTarget = null;
    this.children = {};
  }

  /**
   * Compare two nodes for equality
   */
  public equals(other: Node): boolean {
    return this.blockRoot === other.blockRoot;
  }

  /**
   * Determine which node is 'better'
   */
  public betterThan(other: Node): boolean {
    return (
      // n2 weight greater
      this.weight.gt(other.weight) ||
      // equal weights and lexographically higher root
      (this.weight.eq(other.weight) && this.blockRoot > other.blockRoot)
    );
  }

  /**
   * Update node weight
   */
  public updateWeightWithUpdates(delta: Gwei): void {
    this.weight = this.weight.add(delta);
    if (delta.ltn(0)) {
      this.onRemoveWeight();
    } else {
      this.onAddWeight();
    }
  }

  /**
   * Update best child / best target in the added weight case
   */
  private onAddWeight(): void {
    if (this.parent) {
      // if this node not the best child but has a bigger weight
      if (!this.equals(this.parent.bestChild) && this.betterThan(this.parent.bestChild)) {
        this.parent.bestChild = this;
        this.parent.bestTarget = this.bestTarget;
      }
    }
  }

  /**
   * Update best child / best target in the removed weight case
   */
  private onRemoveWeight(): void {
    if (this.parent) {
      // if this node is the best child it may lost that position
      if (this.equals(this.parent.bestChild)) {
        const newBest = Object.values(this.parent.children).reduce((a, b) => b.betterThan(a) ? b : a, this);
        // no longer the best
        if (!this.equals(newBest)) {
          this.parent.bestChild = newBest;
          this.parent.bestTarget = newBest.bestTarget;
        }
      }
    }
  }
}

/**
 * Calculate best block using
 * Latest Message-Driven Greedy Heaviest Observed SubTree
 * See https://github.com/protolambda/lmd-ghost#state-ful-dag
 */
export class LMDGHOST {
  /**
   * Aggregated attestations
   */
  private aggregator: AttestationAggregator;

  /**
   * Recently seen blocks, pruned up to last finalized block
   */
  private nodes: Record<Root, Node>;

  /**
   * Last finalized block
   */
  private finalized: Node;

  /**
   * Last justified block
   */
  private justified: Node;
  private synced: boolean;

  public constructor() {
    this.aggregator = new AttestationAggregator((hex) => this.nodes[hex] ? this.nodes[hex].slot : null);
    this.nodes = {};
    this.finalized = null;
    this.justified = null;
    this.synced = true;
  }

  public addBlock(slot: Slot, blockRootBuf: bytes32, parentRootBuf: bytes32): void {
    this.synced = false;
    const blockRoot = blockRootBuf.toString('hex');
    const parentRoot = parentRootBuf.toString('hex');
    // ensure blockRoot exists
    const node: Node = this.nodes[blockRoot] || new Node({
      slot,
      blockRoot,
      parent: this.nodes[parentRoot],
    });
    // best target is the node itself
    node.bestTarget = node;
    this.nodes[blockRoot] = node;

    // if parent root exists, link to blockRoot
    if (this.nodes[parentRoot]) {
      this.nodes[parentRoot].children[blockRoot] = node;
      if (Object.values(this.nodes[parentRoot].children).length === 1) {
        // this is the only child, propogate itself as best target as far as necessary
        let c = node;
        let p = c.parent;
        p.bestChild = c;
        while (p) {
          if (c.equals(p.bestChild)) {
            p.bestTarget = node.bestTarget;
            c = p;
            p = p.parent;
          } else {
            // stop propogating when the child is not the best child of the parent
            break;
          }
        }
      }
    }
  }

  public addAttestation(blockRootBuf: bytes32, attester: ValidatorIndex, weight: Gwei): void {
    this.synced = false;
    this.aggregator.addAttestation({
      target: blockRootBuf.toString('hex'),
      attester,
      weight,
    });
  }

  public setFinalized(blockRoot: bytes32): void {
    const rootHex = blockRoot.toString('hex');
    this.finalized = this.nodes[rootHex];
    this.prune();
    this.aggregator.prune();
  }

  public setJustified(blockRoot: bytes32): void {
    const rootHex = blockRoot.toString('hex');
    this.justified = this.nodes[rootHex];
  }

  private prune(): void {
    if (this.finalized) {
      Object.values(this.nodes).forEach((n) => {
        if (n.slot < this.finalized.slot) {
          delete this.nodes[n.blockRoot];
        }
      });
      this.finalized.parent = null;
    }
  }

  public syncChanges(): void {
    // calculate changes
    const changes: [Node, Gwei][] = [];
    let netDelta = new BN(0);
    Object.values(this.aggregator.latestAggregates).forEach((agg) => {
      if (!agg.prevWeight.eq(agg.weight)) {
        const delta = agg.weight.sub(agg.prevWeight);
        agg.prevWeight = agg.weight;
        
        changes.push([this.nodes[agg.target], delta]);
        netDelta = netDelta.add(delta);
      }
    });

    // apply changes
    // back-propagation cut-off strategy:
    // If n has sufficient weight to not lose its position on the canonical chain
    //   (ie: n.weight + delta > (totalWeight + possible change) / 2
    // then the target will stay the same during this run, just propagate the weight adjustment
    let cutOff = (this.finalized ? this.finalized.weight : new BN(0)).add(netDelta);
    changes.forEach(([node, delta]) => {
      let n = node;
      while (n) {
        // update node weight
        n.updateWeightWithUpdates(delta);
        // less possible change = better cutoff
        cutOff = cutOff.sub(delta);
        if (n.parent && n.equals(n.parent.bestChild) && n.weight.muln(2).gt(cutOff)) {
          const target = n.bestTarget;
          n = n.parent;
          while (n) {
            n.bestTarget = target;
            n.weight = n.weight.add(delta);
            n = n.parent;
          }
          break;
        } else {
          n = n.parent;
        }
      }
    });

    this.synced = true;
  }

  public head(): bytes32 {
    assert(this.justified);
    if (!this.synced) {
      this.syncChanges();
    }
    return Buffer.from(this.justified.bestTarget.blockRoot, 'hex');
  }
}
