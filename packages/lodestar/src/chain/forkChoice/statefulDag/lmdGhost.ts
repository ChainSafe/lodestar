/**
 * @module chain/forkChoice
 */

import assert from "assert";

import {fromHexString, toHexString} from "@chainsafe/ssz";
import {Checkpoint, Epoch, Gwei, Number64, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  getCurrentSlot
} from "@chainsafe/lodestar-beacon-state-transition";

import {BlockSummary, ILMDGHOST} from "../interface";

import {HexCheckpoint, NodeInfo, RootHex} from "./interface";
import {GENESIS_EPOCH, ZERO_HASH} from "../../../constants";
import {AttestationAggregator} from "./attestationAggregator";
import {IBeaconClock} from "../../clock/interface";

/**
 * A block root with additional metadata required to form a DAG
 * with vote weights and best blocks stored as metadata
 */
export class Node {
  // block data
  public slot: Slot;
  public blockRoot: RootHex;
  public stateRoot: Root;

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
   * State's current justified check point respective to this block/node.
   */
  public justifiedCheckpoint: HexCheckpoint;

  /**
   * State's finalized check point respective to this block/node
   */
  public finalizedCheckpoint: HexCheckpoint;

  /**
   * All direct children
   */
  public children: Record<RootHex, Node>;

  public constructor({slot, blockRoot, stateRoot, parent, justifiedCheckpoint, finalizedCheckpoint}: NodeInfo) {
    this.slot = slot;
    this.blockRoot = blockRoot;
    this.stateRoot = stateRoot;
    this.parent = parent;
    this.justifiedCheckpoint = justifiedCheckpoint;
    this.finalizedCheckpoint = finalizedCheckpoint;

    this.weight = 0n;
    this.bestChild = null;
    this.bestTarget = null;
    this.children = {};
  }

  public toBlockSummary(): BlockSummary {
    const parent = this.parent;
    let parentRootBuf: Uint8Array;
    if(parent && parent.blockRoot) {
      parentRootBuf = fromHexString(parent.blockRoot);
    } else {
      parentRootBuf = ZERO_HASH;
    }
    return {
      slot: this.slot,
      blockRoot: fromHexString(this.blockRoot),
      parentRoot: parentRootBuf,
      stateRoot: this.stateRoot.valueOf() as Uint8Array,
      justifiedCheckpoint: {
        epoch: this.justifiedCheckpoint.epoch,
        root: fromHexString(this.justifiedCheckpoint.rootHex)
      },
      finalizedCheckpoint: {
        epoch: this.finalizedCheckpoint.epoch,
        root: fromHexString(this.finalizedCheckpoint.rootHex)
      }
    };
  }

  /**
   * Compare two nodes for equality
   */
  public equals(other: Node): boolean {
    return other? this.blockRoot === other.blockRoot : false;
  }

  /**
   * Determine which node is 'better'
   * Weighing system: correct justified/finalized epoch first, then the  internal weight
   * then lexographically higher root
   * @param justifiedCheckpoint the store's justified check point
   * @param finalizedCheckpoint the store's finalized check point
   */
  public betterThan(other: Node, justifiedCheckpoint: HexCheckpoint, finalizedCheckpoint: HexCheckpoint): boolean {
    const isThisGoodForBestTarget = this.bestTarget.isCandidateForBestTarget(justifiedCheckpoint, finalizedCheckpoint);
    const isOtherGoodForBestTarget =
      other.bestTarget.isCandidateForBestTarget(justifiedCheckpoint, finalizedCheckpoint);
    // make sure best target is good first
    if (isThisGoodForBestTarget && !isOtherGoodForBestTarget) {
      return true;
    }

    if (!isThisGoodForBestTarget && isOtherGoodForBestTarget) {
      return false;
    }

    return (
      // n2 weight greater
      this.weight > other.weight ||
      // equal weights and lexographically higher root
      (this.weight === other.weight && this.blockRoot > other.blockRoot)
    );
  }

  /**
   * Add child node.
   * @justifiedCheckpoint: the store's justified check point
   * @finalizedCheckpoint: the store's finalized check point
   */
  public addChild(child: Node, justifiedCheckpoint: HexCheckpoint, finalizedCheckpoint: HexCheckpoint): void {
    this.children[child.blockRoot] = child;
    if (!this.bestChild) {
      // propagate itself as best target as far as necessary
      this.bestChild = child;
      child.propagateWeightChange(0n, justifiedCheckpoint, finalizedCheckpoint);
    }
  }

  /**
   * Check if a leaf is eligible to be a head
   * @param justifiedCheckpoint the store's justified check point
   * @param finalizedCheckpoint the store's finalized check point
   */
  public isCandidateForBestTarget(justifiedCheckpoint: HexCheckpoint, finalizedCheckpoint: HexCheckpoint): boolean {
    if (!justifiedCheckpoint || !finalizedCheckpoint) {
      return true;
    }
    return this.justifiedCheckpoint.epoch === justifiedCheckpoint.epoch &&
      this.justifiedCheckpoint.rootHex === justifiedCheckpoint.rootHex &&
      this.finalizedCheckpoint.epoch === finalizedCheckpoint.epoch &&
      this.finalizedCheckpoint.rootHex === finalizedCheckpoint.rootHex;
  }

  /**
   * Update node weight.
   * delta = 0: node's best target's epochs are conflict to the store or become conform to the store.
   * delta > 0: propagate onAddWeight
   * delta < 0: propagate onRemoveWeight
   * @param justifiedCheckpoint the store's justified check point
   * @param finalizedCheckpoint the store's finalized check point
   */
  public propagateWeightChange(delta: Gwei,
    justifiedCheckpoint: HexCheckpoint,
    finalizedCheckpoint: HexCheckpoint): void {
    this.weight += delta;
    const isAddWeight = (delta > 0)? true :
      (delta < 0)? false : this.bestTarget.isCandidateForBestTarget(justifiedCheckpoint, finalizedCheckpoint);
    if (this.parent) {
      isAddWeight? this.onAddWeight(justifiedCheckpoint, finalizedCheckpoint) :
        this.onRemoveWeight(justifiedCheckpoint, finalizedCheckpoint);
      this.parent.propagateWeightChange(delta, justifiedCheckpoint, finalizedCheckpoint);
    }
  }

  /**
   * Update parent best child / best target in the added weight case
   * @param justifiedCheckpoint the store's justified check point
   * @param finalizedCheckpoint the store's finalized check point
   */
  private onAddWeight(justifiedCheckpoint: HexCheckpoint, finalizedCheckpoint: HexCheckpoint): void {
    const isFirstBestChild = !this.parent.bestChild &&
      this.bestTarget.isCandidateForBestTarget(justifiedCheckpoint, finalizedCheckpoint);
    const needUpdateBestTarget = this.parent.bestChild &&
      (this.equals(this.parent.bestChild) ||
      this.betterThan(this.parent.bestChild, justifiedCheckpoint, finalizedCheckpoint));
    if (isFirstBestChild || needUpdateBestTarget) {
      this.parent.bestChild = this;
      this.parent.bestTarget = this.bestTarget;
    }
  }

  /**
   * Update parent best child / best target in the removed weight case
   * @param justifiedCheckpoint the store's justified check point
   * @param finalizedCheckpoint the store's finalized check point
   */
  private onRemoveWeight(justifiedCheckpoint: HexCheckpoint, finalizedCheckpoint: HexCheckpoint): void {
    // if this node is the best child it may lose that position
    if (this.parent.bestChild && this.equals(this.parent.bestChild)) {
      const newBest = Object.values(this.parent.children)
        .reduce((a, b) => b.betterThan(a, justifiedCheckpoint, finalizedCheckpoint) ? b : a, this);
      // no longer the best
      if (!this.equals(newBest)) {
        this.parent.bestChild = newBest;
        this.parent.bestTarget = newBest.bestTarget;
      } else {
        if (!this.bestTarget.isCandidateForBestTarget(justifiedCheckpoint, finalizedCheckpoint)) {
          // I'm not good but noone is better than me, do a soft unlink to the tree
          // the next addChild call will assign the bestChild
          this.parent.bestChild = null;
        }
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
  private clock: IBeaconClock;

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
   * @param clock
   */
  public async start(genesisTime: number, clock: IBeaconClock): Promise<void> {
    this.genesisTime = genesisTime;
    // Make sure we call onTick at start of each epoch
    clock.onNewEpoch(this.onTick);
    this.clock = clock;
  }

  public async stop(): Promise<void> {
    if (this.clock) {
      this.clock.unsubscribeFromNewEpoch(this.onTick);
    }
  }

  public onTick(): void {
    if (this.bestJustifiedCheckpoint && (!this.justified ||
      this.bestJustifiedCheckpoint.epoch > this.justified.epoch)) {
      this.setJustified(this.bestJustifiedCheckpoint);
      this.ensureCorrectBestTargets();
    }
  }

  public addBlock(
    {slot, blockRoot, stateRoot, parentRoot, justifiedCheckpoint, finalizedCheckpoint}: BlockSummary
  ): void {
    this.synced = false;
    const blockRootHex = toHexString(blockRoot);
    const parentRootHex = toHexString(parentRoot);
    // ensure blockRoot exists
    const node: Node = this.nodes[blockRootHex] || new Node({
      slot,
      blockRoot: blockRootHex,
      stateRoot: stateRoot,
      parent: this.nodes[parentRootHex],
      justifiedCheckpoint: {rootHex: toHexString(justifiedCheckpoint.root), epoch: justifiedCheckpoint.epoch},
      finalizedCheckpoint: {rootHex: toHexString(finalizedCheckpoint.root), epoch: finalizedCheckpoint.epoch},
    });
    // best target is the node itself
    node.bestTarget = node;
    this.nodes[blockRootHex] = node;
    // Check that block is later than the finalized epoch slot (optimization to reduce calls to get_ancestor)
    if (this.finalized) {
      const finalizedSlot = computeStartSlotAtEpoch(this.config, this.finalized.epoch);
      assert(node.slot > finalizedSlot,
        `Fork choice: node slot ${node.slot} should be bigger than finalized slot ${finalizedSlot}`);
      // Check block is a descendant of the finalized block at the checkpoint finalized slot
      assert.equal(
        this.getAncestor(blockRootHex, finalizedSlot),
        this.finalized.node.blockRoot,
        `Fork choice: Block slot ${node.slot} is not on the same chain`);
    }

    let shouldCheckBestTarget = false;
    if (!this.justified || justifiedCheckpoint.epoch > this.justified.epoch) {
      if (!this.bestJustifiedCheckpoint || justifiedCheckpoint.epoch > this.bestJustifiedCheckpoint.epoch) {
        this.bestJustifiedCheckpoint = justifiedCheckpoint;
      }
      if (this.shouldUpdateJustifiedCheckpoint(justifiedCheckpoint.root.valueOf() as Uint8Array)) {
        this.setJustified(justifiedCheckpoint);
        shouldCheckBestTarget = true;
      }
    }
    if (!this.finalized || finalizedCheckpoint.epoch > this.finalized.epoch) {
      this.setFinalized(finalizedCheckpoint);
      shouldCheckBestTarget = true;
      const finalizedSlot = computeStartSlotAtEpoch(this.config, this.finalized.epoch);
      // Update justified if new justified is later than store justified
      // or if store justified is not in chain with finalized checkpoint
      if (justifiedCheckpoint.epoch > this.justified.epoch ||
        this.getAncestor(this.justified.node.blockRoot, finalizedSlot) !== this.finalized.node.blockRoot) {
        this.setJustified(justifiedCheckpoint);
      }
    }
    // if parent root exists, link to blockRoot
    if (this.nodes[parentRootHex]) {
      this.nodes[parentRootHex].addChild(
        node,
        this.getJustifiedCheckpoint(),
        this.getFinalizedCheckpoint());
    }
    if (shouldCheckBestTarget) {
      this.ensureCorrectBestTargets();
    }
  }

  public getNode(blockRootBuf: Uint8Array): Node {
    const blockRoot = toHexString(blockRootBuf);
    return this.nodes[blockRoot];
  }

  // Make sure bestTarget has correct justified_checkpoint and finalized_checkpoint
  public ensureCorrectBestTargets(): void {
    const leafNodes = Object.values(this.nodes).filter(n => (Object.values(n.children).length === 0));
    const incorrectBestTargets = leafNodes.filter(
      leaf => !leaf.isCandidateForBestTarget(this.getJustifiedCheckpoint(), this.getFinalizedCheckpoint()));
    // step down as best targets
    incorrectBestTargets.forEach(
      node => node.propagateWeightChange(0n, this.getJustifiedCheckpoint(), this.getFinalizedCheckpoint()));
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

        this.nodes[agg.target].propagateWeightChange(
          delta,
          this.getJustifiedCheckpoint(),
          this.getFinalizedCheckpoint());
      }
    });

    this.synced = true;
  }

  public head(): BlockSummary {
    return this.headNode().toBlockSummary();
  }
  public headNode(): Node {
    assert(this.justified);
    if (!this.synced) {
      this.syncChanges();
    }
    return this.justified.node.bestTarget;
  }

  public headStateRoot(): Uint8Array {
    return this.head().stateRoot;
  }

  public headBlockRoot(): Uint8Array {
    return this.head().blockRoot;
  }

  public headBlockSlot(): Slot {
    return this.head().slot;
  }

  public getBlockSummaryAtSlot(slot: Slot): BlockSummary | null {
    const head = this.headNode();
    let node = head;
    // navigate from the head node, up the chain until either the slot is found or the slot is passed
    while(node.slot !== slot) {
      if (node.slot < slot) {
        return null;
      }
      node = node.parent;
    }
    return node.toBlockSummary();
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
    const justifiedSlot = computeStartSlotAtEpoch(this.config, this.justified.epoch);
    if (this.getAncestor(hexBlockRoot, justifiedSlot) !== this.justified.node.blockRoot) {
      return false;
    }

    return true;
  }

  public getJustified(): Checkpoint {
    if (!this.justified) {
      return {epoch: 0, root: ZERO_HASH};
    }
    return this.head().justifiedCheckpoint;
  }

  public getFinalized(): Checkpoint {
    if (!this.finalized) {
      return {epoch: 0, root: ZERO_HASH};
    }
    return this.head().finalizedCheckpoint;
  }

  /**
   * Don't want to check the initial justified/finalized checkpoint for the 1st epoch
   * because initial state does not have checkpoints in database.
   * First addBlock (for genesis block) call has checkpoints but from the 2nd call in the
   * first epoch it has ZERO finalized/justified checkpoints.
   */
  private getJustifiedCheckpoint(): HexCheckpoint {
    if (this.finalized.epoch === GENESIS_EPOCH) {
      return null;
    }
    return {rootHex: this.justified.node.blockRoot, epoch: this.justified.epoch};
  }

  /**
   * Don't want to check the initial justified/finalized checkpoint for the 1st epoch
   * because initial state does not have checkpoints in database.
   * First addBlock (for genesis block) call has checkpoints but from the 2nd call in the
   * first epoch it has ZERO finalized/justified checkpoints.
   */
  private getFinalizedCheckpoint(): HexCheckpoint {
    if (this.finalized.epoch === GENESIS_EPOCH) {
      return null;
    }
    return {rootHex: this.finalized.node.blockRoot, epoch: this.finalized.epoch};
  }

  private setFinalized(checkpoint: Checkpoint): void {
    this.synced = false;
    const rootHex = toHexString(checkpoint.root);
    this.finalized = {node: this.nodes[rootHex], epoch: checkpoint.epoch};
    this.prune();
    this.aggregator.prune();
  }

  private setJustified(checkpoint: Checkpoint): void {
    const {root: blockRoot, epoch} = checkpoint;
    const rootHex = toHexString(blockRoot);
    this.justified = {node: this.nodes[rootHex], epoch};
  }

  private getAncestor(root: RootHex, slot: Slot): RootHex | null {
    const node = this.nodes[root];
    if (!node) {
      return null;
    }
    if (node.slot > slot) {
      return (node.parent)? this.getAncestor(node.parent.blockRoot, slot) : null;
    } else if (node.slot === slot) {
      return node.blockRoot;
    } else {
      // root is older than queried slot, thus a skip slot. Return latest root prior to slot
      return root;
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
