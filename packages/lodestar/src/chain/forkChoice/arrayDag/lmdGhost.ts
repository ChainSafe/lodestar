/**
 * @module chain/forkChoice
 */

import {fromHexString, toHexString} from "@chainsafe/ssz";
import {Checkpoint, Epoch, Gwei, Number64, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  getCurrentSlot
} from "@chainsafe/lodestar-beacon-state-transition";
import {assert} from "@chainsafe/lodestar-utils";

import {BlockSummary, HexCheckpoint, ILMDGHOST, NO_NODE, RootHex} from "../interface";

import {NodeInfo} from "./interface";
import {GENESIS_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../../../constants";
import {AttestationAggregator} from "../attestationAggregator";
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
   * Parent node index, the previous block
   */
  public parent: number;

  /**
   * Child node index with the most weight
   */
  public bestChild: number;

  /**
   * Decendent node index with the most weight
   */
  public bestTarget: number;

  /**
   * State's current justified check point respective to this block/node.
   */
  public justifiedCheckpoint: HexCheckpoint;

  /**
   * State's finalized check point respective to this block/node
   */
  public finalizedCheckpoint: HexCheckpoint;

  /**
   * All direct children with key as root hex and value as node index
   */
  public children: Record<RootHex, number>;

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

  /**
   * Compare two nodes for equality
   */
  public equals(other: Node): boolean {
    return other? this.blockRoot === other.blockRoot : false;
  }

  public unassignBestChild(): void {
    this.bestChild = NO_NODE;
  }

  public hasBestChild(): boolean {
    return typeof(this.bestChild) === "number" && this.bestChild >= 0;
  }

  public hasParent(): boolean {
    return typeof(this.parent) === "number" && this.parent >= 0;
  }

  public shiftIndex(n: number): void {
    assert.gte(n, 0, "Shift index must be positive");
    if (this.hasBestChild()) {
      this.bestChild = this.bestChild - n;
    }
    if (this.hasParent()) {
      this.parent = this.parent - n;
    }
    if (this.bestTarget) {
      this.bestTarget = this.bestTarget - n;
    }
    Object.keys(this.children).forEach(blockRoot => this.children[blockRoot] = this.children[blockRoot] - n);
  }

}

/**
 * Calculate best block using
 * Latest Message-Driven Greedy Heaviest Observed SubTree
 *
 * See https://github.com/protolambda/lmd-ghost#array-based-stateful-dag-proto_array
 */
export class ArrayDagLMDGHOST implements ILMDGHOST {
  private readonly config: IBeaconConfig;
  private genesisTime: Number64;


  /**
   * Aggregated attestations
   */
  private aggregator: AttestationAggregator;

  /**
   * Recently seen blocks, pruned up to last finalized block
   */
  private nodes: Node[];

  /**
   * A map with key as root hex and value as index in `nodes` array
   */
  private nodeIndices: Map<RootHex, number>;

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
    const slotFinder = (hex: string): Slot | null =>
      this.nodeIndices.get(hex) ? this.nodes[this.nodeIndices.get(hex)].slot : null;
    this.aggregator = new AttestationAggregator(slotFinder);
    this.nodes = [];
    this.nodeIndices = new Map();
    this.finalized = null;
    this.justified = null;
    this.synced = true;
    this.config = config;
  }

  /**
   * Start method, should not wait for it.
   * @param genesisTime
   */
  public async start(genesisTime: number, clock: IBeaconClock): Promise<void> {
    this.genesisTime = genesisTime;
    // Make sure we call onTick at start of each epoch
    clock.onNewEpoch(this.onTick);
    this.clock = clock;
  }

  public async stop(): Promise<void> {
    this.clock.unsubscribeFromNewEpoch(this.onTick);
  }

  public onTick(): void {
    if (this.bestJustifiedCheckpoint && (!this.justified ||
      this.bestJustifiedCheckpoint.epoch > this.justified.epoch)) {
      this.setJustified(this.bestJustifiedCheckpoint);
      this.ensureCorrectBestTargets();
    }
  }

  public addBlock({slot, blockRoot, stateRoot, parentRoot,
    justifiedCheckpoint, finalizedCheckpoint}: BlockSummary): void {
    this.synced = false;
    const blockRootHex = toHexString(blockRoot);
    const parentRootHex = toHexString(parentRoot);
    if(this.getNode(blockRoot)) {
      // existing block
      return;
    }

    // ensure blockRoot exists
    const node: Node = new Node({
      slot,
      blockRoot: blockRootHex,
      stateRoot: stateRoot,
      parent: this.nodeIndices.get(parentRootHex),
      justifiedCheckpoint: {rootHex: toHexString(justifiedCheckpoint.root), epoch: justifiedCheckpoint.epoch},
      finalizedCheckpoint: {rootHex: toHexString(finalizedCheckpoint.root), epoch: finalizedCheckpoint.epoch},
    });
    this.nodes.push(node);
    const nodeIndex = this.nodes.length - 1;
    this.nodeIndices.set(blockRootHex, nodeIndex);
    // best target is the node itself
    node.bestTarget = nodeIndex;
    // Check that block is later than the finalized epoch slot (optimization to reduce calls to get_ancestor)
    if (this.finalized && this.finalized.node) {
      const finalizedSlot = computeStartSlotAtEpoch(this.config, this.finalized.epoch);
      assert.gt(node.slot, finalizedSlot, "Fork choice: node slot should be bigger than finalized slot");
      // Check block is a descendant of the finalized block at the checkpoint finalized slot
      assert.equal(
        this.getAncestor(blockRootHex, finalizedSlot), 
        this.finalized.node.blockRoot,
        `Fork choice: Block slot ${node.slot} is not on the same chain, finalized slot=${finalizedSlot}`
      );
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
        (this.finalized.node &&
          this.getAncestor(this.justified.node.blockRoot, finalizedSlot) !== this.finalized.node.blockRoot)) {
        this.setJustified(justifiedCheckpoint);
      }
    }
    // if parent root exists, link to blockRoot
    if (node.hasParent()) {
      // nodeIndex may not be correct after setFinalized
      this.addChild(node.parent, this.nodeIndices.get(node.blockRoot));
    }
    if (shouldCheckBestTarget) {
      this.ensureCorrectBestTargets();
    }
  }

  /**
   * Add child node.
   */
  public addChild(parentIndex: number, childIndex: number): void {
    const parent = this.nodes[parentIndex];
    const child = this.nodes[childIndex];
    parent.children[child.blockRoot] = childIndex;
    if (!parent.hasBestChild()) {
      // propagate itself as best target as far as necessary
      parent.bestChild = childIndex;
      this.propagateWeightChange(childIndex, 0n);
    }
  }

  public getNode(blockRootBuf: Uint8Array): Node {
    const blockRoot = toHexString(blockRootBuf);
    const index = this.nodeIndices.get(blockRoot);
    return this.nodes[index];
  }

  public isBestTarget(parent: Node, child: Node): boolean {
    return this.nodeIndices.get(child.blockRoot) === parent.bestTarget;
  }

  public isBestChild(parent: Node, child: Node): boolean {
    return this.nodeIndices.get(child.blockRoot) === parent.bestChild;
  }

  // Make sure bestTarget has correct justified_checkpoint and finalized_checkpoint
  public ensureCorrectBestTargets(): void {
    const leafNodeIdxs = this.nodes.filter((n) => Object.values(n.children).length === 0)
      .map(n => this.nodeIndices.get(n.blockRoot));
    const incorrectBestTargets = leafNodeIdxs.filter(idx => !this.isCandidateForBestTarget(idx));
    // step down as best targets
    incorrectBestTargets.forEach(idx => this.propagateWeightChange(idx, 0n));
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

        this.propagateWeightChange(this.nodeIndices.get(agg.target), delta);
      }
    });

    this.synced = true;
  }

  public head(): BlockSummary {
    if (!this.headNode()) {
      return null;
    }
    return this.toBlockSummary(this.headNode());
  }

  public headNode(): Node {
    assert.true(Boolean(this.justified), "Justified checkpoint does not exist");
    if (!this.synced) {
      this.syncChanges();
    }
    return this.justified.node? this.nodes[this.justified.node.bestTarget] : null;
  }

  public headBlockRoot(): Uint8Array {
    const head = this.head();
    return head? head.blockRoot : ZERO_HASH;
  }

  public headBlockSlot(): Slot {
    const head = this.head();
    return head? head.slot : GENESIS_SLOT;
  }

  public headStateRoot(): Uint8Array {
    assert.true(Boolean(this.justified), "Justified checkpoint does not exist");
    if (!this.synced) {
      this.syncChanges();
    }
    const bestTarget = this.nodes[this.justified.node.bestTarget];
    return bestTarget.stateRoot.valueOf() as Uint8Array;
  }

  public getCanonicalBlockSummaryAtSlot(slot: Slot): BlockSummary | null {
    let node = this.headNode();
    if (!node) {
      return null;
    }
    // navigate from the head node, up the chain until either the slot is found or the slot is passed
    while(node.slot !== slot) {
      if (node.slot < slot || !node.hasParent()) {
        return null;
      }
      node = this.nodes[node.parent];
    }
    return this.toBlockSummary(node);
  }

  public getBlockSummariesAtSlot(slot: Slot): BlockSummary[] {
    return this.nodes
      .filter((node) => this.config.types.Slot.equals(node.slot, slot))
      .map((node) => this.toBlockSummary(node));
  }

  public getBlockSummaryByBlockRoot(blockRoot: Uint8Array): BlockSummary | null {
    const node = this.getNode(blockRoot);
    return (node)? this.toBlockSummary(node) : null;
  }

  public hasBlock(blockRoot: Uint8Array): boolean {
    return !!this.getNode(blockRoot);
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
    if (this.justified.node && this.getAncestor(hexBlockRoot, justifiedSlot) !== this.justified.node.blockRoot) {
      return false;
    }

    return true;
  }

  public getJustified(): Checkpoint {
    if (!this.justified || !this.justified.node) {
      return null;
    }
    return {root: fromHexString(this.justified.node.blockRoot), epoch: this.justified.epoch};
  }

  public getFinalized(): Checkpoint {
    if (!this.finalized || !this.finalized.node) {
      return null;
    }
    return {root: fromHexString(this.finalized.node.blockRoot), epoch: this.finalized.epoch};
  }

  /**
   * Update node weight.
   * delta = 0: node's best target's epochs are conflict to the store or become conform to the store.
   * delta > 0: propagate onAddWeight
   * delta < 0: propagate onRemoveWeight
   */
  private propagateWeightChange(nodeIndex: number, delta: Gwei): void {
    const node = this.nodes[nodeIndex];
    node.weight += delta;
    const isAddWeight = (delta > 0)? true :
      (delta < 0)? false : this.isCandidateForBestTarget(node.bestTarget);
    if (node.hasParent()) {
      isAddWeight? this.onAddWeight(nodeIndex) : this.onRemoveWeight(nodeIndex);
      this.propagateWeightChange(node.parent, delta);
    }
  }

  /**
   * Check if a leaf is eligible to be a head
   */
  private isCandidateForBestTarget(nodeIndex: number): boolean {
    const node = this.nodes[nodeIndex];
    if (!this.getJustifiedCheckpoint() || !this.getFinalizedCheckpoint()) {
      return true;
    }
    return node.justifiedCheckpoint.epoch === this.getJustifiedCheckpoint().epoch &&
    node.justifiedCheckpoint.rootHex === this.getJustifiedCheckpoint().rootHex &&
    node.finalizedCheckpoint.epoch === this.getFinalizedCheckpoint().epoch &&
    node.finalizedCheckpoint.rootHex === this.getFinalizedCheckpoint().rootHex;
  }

  /**
   * Update parent best child / best target in the added weight case
   */
  private onAddWeight(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    const parentNode: Node = this.nodes[node.parent];
    const isFirstBestChild = !parentNode.hasBestChild() &&
      this.isCandidateForBestTarget(node.bestTarget);
    const needUpdateBestTarget = parentNode.hasBestChild() &&
      (this.isBestChildOfParent(node) || this.betterThan(nodeIndex, parentNode.bestChild));
    if (isFirstBestChild || needUpdateBestTarget) {
      parentNode.bestChild = this.nodeIndices.get(node.blockRoot);
      parentNode.bestTarget = node.bestTarget;
    }
  }

  /**
   * Update parent best child / best target in the removed weight case
   */
  private onRemoveWeight(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    const parentNode = this.nodes[node.parent];
    // if this node is the best child it may lose that position
    if (this.isBestChildOfParent(node)) {
      const newBest = Object.values(parentNode.children)
        .reduce((a, b) => this.betterThan(a, b) ? a : b);
      // no longer the best
      if (nodeIndex !== newBest) {
        parentNode.bestChild = newBest;
        parentNode.bestTarget = this.nodes[newBest].bestTarget;
      } else {
        if (!this.isCandidateForBestTarget(node.bestTarget)) {
          // I'm not good but noone is better than me, do a soft unlink to the tree
          // the next addChild call will assign the bestChild
          parentNode.unassignBestChild();
        }
      }
    }
  }

  /**
   * Determine which node is 'better'
   * Weighing system: correct justified/finalized epoch first, then the  internal weight
   * then lexographically higher root
   */
  private betterThan(nodeIndex: number, otherIndex: number): boolean {
    const node = this.nodes[nodeIndex];
    const other = this.nodes[otherIndex];
    const isNodeBestTargetGood = this.isCandidateForBestTarget(node.bestTarget);
    const isOtherBestTargetGood = this.isCandidateForBestTarget(other.bestTarget);
    // make sure best target is good first
    if (isNodeBestTargetGood && !isOtherBestTargetGood) {
      return true;
    }

    if (!isNodeBestTargetGood && isOtherBestTargetGood) {
      return false;
    }

    return (
      // n2 weight greater
      node.weight > other.weight ||
      // equal weights and lexographically higher root
      (node.weight === other.weight && node.blockRoot > other.blockRoot)
    );
  }

  private isBestChildOfParent(node: Node): boolean {
    if (!node.hasParent) {
      return false;
    }
    const nodeIndex = this.nodeIndices.get(node.blockRoot);
    const parentNode: Node = this.nodes[node.parent];
    return parentNode.bestChild === nodeIndex;
  }

  /**
   * Don't want to check the initial justified/finalized checkpoint for the 1st epoch
   * because initial state does not have checkpoints in database.
   * First addBlock (for genesis block) call has checkpoints but from the 2nd call in the
   * first epoch it has ZERO finalized/justified checkpoints.
   */
  private getJustifiedCheckpoint(): HexCheckpoint {
    if (this.finalized.epoch === GENESIS_EPOCH || !this.justified.node) {
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
    if (this.finalized.epoch === GENESIS_EPOCH || !this.finalized.node) {
      return null;
    }
    return {rootHex: this.finalized.node.blockRoot, epoch: this.finalized.epoch};
  }

  private setFinalized(checkpoint: Checkpoint): void {
    this.synced = false;
    const rootHex = toHexString(checkpoint.root);
    const idx = this.nodeIndices.get(rootHex);
    this.finalized = {node: this.nodes[idx], epoch: checkpoint.epoch};
    this.prune();
    this.aggregator.prune();
  }

  private setJustified(checkpoint: Checkpoint): void {
    const {root: blockRoot, epoch} = checkpoint;
    const rootHex = toHexString(blockRoot);
    const idx = this.nodeIndices.get(rootHex);
    this.justified = {node: this.nodes[idx], epoch};
  }

  private getAncestor(root: RootHex, slot: Slot): RootHex | null {
    const idx = this.nodeIndices.get(root);
    if (idx === undefined) {
      return null;
    }
    const node = this.nodes[idx];
    if (node.slot > slot) {
      if (node.hasParent()) {
        const parentNode = this.nodes[node.parent];
        return this.getAncestor(parentNode.blockRoot, slot);
      } else {
        return null;
      }
      // return (node.hasParent())? this.getAncestor(parentNode.blockRoot, slot) : null;
    } else if (node.slot === slot) {
      return node.blockRoot;
    } else {
      // root is older than queried slot, thus a skip slot. Return latest root prior to slot
      return root;
    }
  }

  private prune(): void {
    if (this.finalized && this.finalized.node) {
      const nodesToDel = this.nodes.filter(node => node.slot < this.finalized.node.slot).map(node => node.blockRoot);
      const numDelete = nodesToDel.length;
      this.nodes = this.nodes.slice(numDelete);
      // Update indexes in node
      this.nodes.forEach(node => node.shiftIndex(numDelete));
      nodesToDel.forEach(blockRoot => this.nodeIndices.delete(blockRoot));
      // Update indexes in nodeIndices
      for (const key of this.nodeIndices.keys()) {
        const value = this.nodeIndices.get(key);
        this.nodeIndices.set(key, value - numDelete);
      }
      this.finalized.node.parent = NO_NODE;
    }
  }

  private toBlockSummary(node: Node): BlockSummary {
    let parentRootBuf: Uint8Array;
    if(node.hasParent()) {
      parentRootBuf = fromHexString(this.nodes[node.parent].blockRoot);
    } else {
      parentRootBuf = ZERO_HASH;
    }
    return {
      slot: node.slot,
      blockRoot: fromHexString(node.blockRoot),
      parentRoot: parentRootBuf,
      stateRoot: node.stateRoot.valueOf() as Uint8Array,
      justifiedCheckpoint: {
        epoch: node.justifiedCheckpoint.epoch,
        root: fromHexString(node.justifiedCheckpoint.rootHex)
      },
      finalizedCheckpoint: {
        epoch: node.finalizedCheckpoint.epoch,
        root: fromHexString(node.finalizedCheckpoint.rootHex)
      }
    };
  }

}
