/**
 * @module chain/forkChoice
 */

import assert from "assert";

import { fromHexString, toHexString } from "@chainsafe/ssz";
import { Gwei, Slot, ValidatorIndex, Number64, Checkpoint, Epoch } from "@chainsafe/lodestar-types";
import { IBeaconConfig } from "@chainsafe/lodestar-config";
import { computeSlotsSinceEpochStart, getCurrentSlot } from "@chainsafe/lodestar-beacon-state-transition";

import { ILMDGHOST } from "../interface";

import { AttestationAggregator, RootHex, } from "./attestationAggregator";
import { sleep } from "../../../util/sleep";


/**
 * A block root with additional metadata required to form a DAG
 * with vote weights and best blocks stored as metadata
 */
class Node {
  // block data
  public slot: Slot;
  public blockRoot: RootHex;

  /**
   * Total weight for a block and its children
   */
  public weight: Gwei;

  /**
   * Parent node, the previous block
   */
  public parent: Node | null;

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
  public children: Record<RootHex, Node>;

  public constructor({ slot, blockRoot, parent }: { slot: Slot; blockRoot: RootHex; parent: Node }) {
    this.slot = slot;
    this.blockRoot = blockRoot;
    this.parent = parent;

    this.weight = 0n;
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
      this.weight > other.weight ||
      // equal weights and lexographically higher root
      (this.weight === other.weight && this.blockRoot > other.blockRoot)
    );
  }

  /**
   * Add child node
   */
  public addChild(child: Node): void {
    this.children[child.blockRoot] = child;
    if (Object.values(this.children).length === 1) {
      // this is the only child, propagate itself as best target as far as necessary
      this.bestChild = child;
      let c: Node = child;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      let p: Node = this;
      while (p) {
        if (c.equals(p.bestChild)) {
          p.bestTarget = child.bestTarget;
          c = p;
          p = p.parent;
        } else {
          // stop propagating when the child is not the best child of the parent
          break;
        }
      }
    }
  }

  /**
   * Update node weight
   */
  public propagateWeightChange(delta: Gwei): void {
    this.weight += delta;
    if (this.parent) {
      if (delta < 0) {
        this.onRemoveWeight();
      } else {
        this.onAddWeight();
      }
      this.parent.propagateWeightChange(delta);
    }
  }

  /**
   * Update parent best child / best target in the added weight case
   */
  private onAddWeight(): void {
    if (this.equals(this.parent.bestChild) || this.betterThan(this.parent.bestChild)) {
      this.parent.bestChild = this;
      this.parent.bestTarget = this.bestTarget;
    }
  }

  /**
   * Update parent best child / best target in the removed weight case
   */
  private onRemoveWeight(): void {
    // if this node is the best child it may lose that position
    if (this.equals(this.parent.bestChild)) {
      const newBest = Object.values(this.parent.children)
        .reduce((a, b) => b.betterThan(a) ? b : a, this);
      // no longer the best
      if (!this.equals(newBest)) {
        this.parent.bestChild = newBest;
        this.parent.bestTarget = newBest.bestTarget;
      }
    }
  }
}

/**
 * Calculate best block using
 * Latest Message-Driven Greedy Heaviest Observed SubTree
 *
 * See https://github.com/protolambda/lmd-ghost#state-ful-dag
 */
export class StatefulDagLMDGHOST implements ILMDGHOST {
  private readonly config: IBeaconConfig;
  private genesisTime: Number64;

  /**
   * Aggregated attestations
   */
  private aggregator: AttestationAggregator;

  /**
   * Recently seen blocks, pruned up to last finalized block
   */
  private nodes: Record<RootHex, Node>;

  /**
   * Last finalized block
   */
  private finalized: { node: Node; epoch: Epoch } | null;

  /**
   * Last justified block
   */
  private justified: { node: Node; epoch: Epoch } | null;
  /**
   * Best justified checkpoint.
   */
  private bestJustifiedCheckpoint: Checkpoint;
  private synced: boolean;
  private interval: NodeJS.Timeout;

  public constructor(config: IBeaconConfig) {
    this.aggregator =
      new AttestationAggregator((hex: string) => this.nodes[hex] ? this.nodes[hex].slot : null);
    this.nodes = {};
    this.finalized = null;
    this.justified = null;
    this.synced = true;
    this.config = config;
  }

  /**
   * Start method, should not wait for it.
   * @param genesisTime
   */
  public async start(genesisTime: number): Promise<void> {
    this.genesisTime = genesisTime;
    const numSlot = computeSlotsSinceEpochStart(this.config, getCurrentSlot(this.config, this.genesisTime));
    const timeToWaitTillNextEpoch = (
      (this.config.params.SLOTS_PER_EPOCH - numSlot) * this.config.params.SECONDS_PER_SLOT * 1000
    );
    // Make sure we call onTick at start of each epoch
    await sleep(timeToWaitTillNextEpoch);
    const epochInterval = this.config.params.SLOTS_PER_EPOCH * this.config.params.SECONDS_PER_SLOT * 1000;
    if (!this.interval) {
      this.interval = setInterval(this.onTick.bind(this), epochInterval);
    }
  }

  public async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  public onTick(): void {
    if (this.bestJustifiedCheckpoint && (!this.justified ||
      this.bestJustifiedCheckpoint.epoch > this.justified.epoch)) {
      this.setJustified(this.bestJustifiedCheckpoint);
    }
  }

  public addBlock(slot: Slot, blockRootBuf: Uint8Array, parentRootBuf: Uint8Array,
    justifiedCheckpoint?: Checkpoint, finalizedCheckpoint?: Checkpoint): void {
    this.synced = false;
    const blockRoot = toHexString(blockRootBuf);
    const parentRoot = toHexString(parentRootBuf);
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
      this.nodes[parentRoot].addChild(node);
    }
    if (justifiedCheckpoint && (!this.justified || justifiedCheckpoint.epoch > this.justified.epoch)) {
      if (this.bestJustifiedCheckpoint) {
        if (!this.justified ||
          justifiedCheckpoint.epoch > this.bestJustifiedCheckpoint.epoch) {
          this.checkAndSetJustified(justifiedCheckpoint);
        }
      } else {
        this.checkAndSetJustified(justifiedCheckpoint);
      }
    }
    if (finalizedCheckpoint && (!this.finalized || finalizedCheckpoint.epoch > this.finalized.epoch)) {
      this.setFinalized(finalizedCheckpoint);
    }
  }

  public addAttestation(blockRootBuf: Uint8Array, attester: ValidatorIndex, weight: Gwei): void {
    this.synced = false;
    this.aggregator.addAttestation({
      target: toHexString(blockRootBuf),
      attester,
      weight,
    });
  }

  public syncChanges(): void {
    Object.values(this.aggregator.latestAggregates).forEach((agg) => {
      if (!(agg.prevWeight === agg.weight)) {
        const delta = agg.weight - agg.prevWeight;
        agg.prevWeight = agg.weight;

        this.nodes[agg.target].propagateWeightChange(delta);
      }
    });

    this.synced = true;
  }

  public head(): Uint8Array {
    assert(this.justified);
    if (!this.synced) {
      this.syncChanges();
    }
    return fromHexString(this.justified.node.bestTarget.blockRoot);
  }

  // To address the bouncing attack, only update conflicting justified
  //  checkpoints in the fork choice if in the early slots of the epoch.
  public shouldUpdateJustifiedCheckpoint(blockRoot: Uint8Array): boolean {
    if (!this.justified) {
      return true;
    }
    if (computeSlotsSinceEpochStart(this.config, getCurrentSlot(this.config, this.genesisTime)) <
      this.config.params.SAFE_SLOTS_TO_UPDATE_JUSTIFIED) {
      return true;
    }
    const hexBlockRoot = toHexString(blockRoot);
    const newJustifiedBlock = this.nodes[hexBlockRoot];
    if (newJustifiedBlock.slot <= this.justified.node.slot) {
      return false;
    }
    if (this.getAncestor(hexBlockRoot, this.justified.node.slot) !== this.justified.node.blockRoot) {
      return false;
    }

    return true;
  }

  public getJustified(): Checkpoint {
    if (!this.justified) {
      return null;
    }
    return { root: fromHexString(this.justified.node.blockRoot), epoch: this.justified.epoch };
  }

  public getFinalized(): Checkpoint {
    if (!this.finalized) {
      return null;
    }
    return { root: fromHexString(this.finalized.node.blockRoot), epoch: this.finalized.epoch };
  }

  private setFinalized(checkpoint: Checkpoint): void {
    this.synced = false;
    const rootHex = toHexString(checkpoint.root);
    this.finalized = { node: this.nodes[rootHex], epoch: checkpoint.epoch };
    this.prune();
    this.aggregator.prune();
  }

  private checkAndSetJustified(checkpoint: Checkpoint): void {
    this.bestJustifiedCheckpoint = checkpoint;
    if (this.shouldUpdateJustifiedCheckpoint(checkpoint.root.valueOf() as Uint8Array)) {
      this.setJustified(checkpoint);
    }
  }

  private setJustified(checkpoint: Checkpoint): void {
    const { root: blockRoot, epoch } = checkpoint;
    const rootHex = toHexString(blockRoot);
    this.justified = { node: this.nodes[rootHex], epoch };
  }

  private getAncestor(root: RootHex, slot: Slot): RootHex | null {
    const node = this.nodes[root];
    if (!node) {
      return null;
    }
    if (node.slot > slot) {
      return this.getAncestor(node.parent.blockRoot, slot);
    } else if (node.slot === slot) {
      return node.blockRoot;
    } else {
      return null;
    }
  }

  private prune(): void {
    if (this.finalized) {
      Object.values(this.nodes).forEach((n) => {
        if (n.slot < this.finalized.node.slot) {
          delete this.nodes[n.blockRoot];
        }
      });
      this.finalized.node.parent = null;
    }
  }
}
