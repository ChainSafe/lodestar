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

import {BlockSummary, HexCheckpoint, ILMDGHOST, NO_NODE, RootHex, ForkChoiceEventEmitter} from "../interface";

import {NodeInfo} from "./interface";
import {GENESIS_EPOCH, GENESIS_SLOT, ZERO_HASH} from "../../../constants";
import {AttestationAggregator} from "../attestationAggregator";
import {IBeaconClock} from "../../clock/interface";
import {EventEmitter} from "events";
import {notNullish} from "../../../util/notNullish";

/**
 * RootHex > number ES6 Map that asserts return values
 */
class NodeIndices {
  map: Map<RootHex, number>;

  constructor () {
    this.map = new Map<RootHex, number>();
  }

  getStrict(key: RootHex): number {
    const value = this.map.get(key);
    if (!value) throw Error(`No index for root ${key}`);
    return value;
  }
  get(key: RootHex): number | null {
    return this.map.get(key) ?? null;
  }
  set(key: RootHex, value: number): void {
    this.map.set(key, value);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
}

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
   * After pruning the fork choice, the finalized node doesn't have a parent
   */
  public parent: number | null;

  /**
   * Child node index with the most weight
   */
  public bestChild: number | null;

  /**
   * Decendent node index with the most weight
   */
  public bestTarget: number | null;

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

    this.weight = BigInt(0);
    this.bestChild = NO_NODE;
    this.bestTarget = NO_NODE;
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

  public shiftIndex(oldNodes: Node[], newNodeIndexes: NodeIndices): void {
    if (this.bestChild !== null) {
      const bestChildRoot = oldNodes[this.bestChild].blockRoot;
      this.bestChild = newNodeIndexes.get(bestChildRoot);
    }
    if (this.parent !== null) {
      const parentRoot = oldNodes[this.parent].blockRoot;
      // this may be undefined because its parent is deleted from node
      this.parent = newNodeIndexes.get(parentRoot);
    }
    if (this.bestTarget) {
      const bestTargetRoot = oldNodes[this.bestTarget].blockRoot;
      this.bestTarget = newNodeIndexes.get(bestTargetRoot);
    }
    Object.keys(this.children).forEach(blockRoot => this.children[blockRoot] = newNodeIndexes.getStrict(blockRoot));
  }

}

/**
 * Calculate best block using
 * Latest Message-Driven Greedy Heaviest Observed SubTree
 *
 * See https://github.com/protolambda/lmd-ghost#array-based-stateful-dag-proto_array
 */
export class ArrayDagLMDGHOST extends (EventEmitter as { new(): ForkChoiceEventEmitter }) implements ILMDGHOST {
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
  private nodeIndices: NodeIndices;

  /**
   * Last finalized block
   * According to the spec, finalized should never be null. It's only due to this constructor architecture
   */
  private finalized: {node: Node | null; epoch: Epoch} | null;

  /**
   * Last justified block
   * According to the spec, justified should never be null. It's only due to this constructor architecture
   */
  private justified: {node: Node | null; epoch: Epoch} | null;
  /**
   * Best justified checkpoint.
   */
  private bestJustifiedCheckpoint?: Checkpoint;
  private synced: boolean;
  private clock: IBeaconClock;

  public constructor(config: IBeaconConfig) {
    super();
    const slotFinder = (hex: string): Slot | null =>
      this.nodeIndices.get(hex) ? this.nodes[this.nodeIndices.getStrict(hex)].slot : null;
    this.aggregator = new AttestationAggregator(slotFinder);
    this.nodes = [];
    this.nodeIndices = new NodeIndices();
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
    this.clock && this.clock.unsubscribeFromNewEpoch(this.onTick);
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
      // genesis or first known block will not have a parent
      // TODO: Fix when refactoring start / stop architecture
      parent: this.nodeIndices.get(parentRootHex) ?? null,
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
        this.getAncestorHex(blockRootHex, finalizedSlot),
        this.finalized.node.blockRoot,
        `Fork choice: Block slot ${node.slot} is not on the same chain, finalized slot=${finalizedSlot}`,
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
      const finalized = this.setFinalized(finalizedCheckpoint);
      shouldCheckBestTarget = true;
      const finalizedSlot = computeStartSlotAtEpoch(this.config, finalized.epoch);
      // Update justified if new justified is later than store justified
      // or if store justified is not in chain with finalized checkpoint
      if (this.justified && (justifiedCheckpoint.epoch > this.justified.epoch ||
        (finalized.node && this.justified.node &&
          this.getAncestorHex(this.justified.node.blockRoot, finalizedSlot) !== finalized.node.blockRoot))) {
        this.setJustified(justifiedCheckpoint);
      }
    }
    // if parent root exists, link to blockRoot
    if (node.parent !== null) {
      // nodeIndex may not be correct after setFinalized
      this.addChild(node.parent, this.nodeIndices.getStrict(node.blockRoot));
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
    if (parent.bestChild === null) {
      // propagate itself as best target as far as necessary
      parent.bestChild = childIndex;
      this.propagateWeightChange(childIndex, BigInt(0));
    }
  }

  public getNode(blockRootBuf: Uint8Array): Node | null {
    const blockRoot = toHexString(blockRootBuf);
    const index = this.nodeIndices.get(blockRoot);
    if (index === null) return null;
    return this.nodes[index] ?? null;
  }

  public isBestTarget(parent: Node, child: Node): boolean {
    return this.nodeIndices.get(child.blockRoot) === parent.bestTarget;
  }

  public isBestChild(parent: Node, child: Node): boolean {
    return this.nodeIndices.get(child.blockRoot) === parent.bestChild;
  }

  // Make sure bestTarget has correct justified_checkpoint and finalized_checkpoint
  public ensureCorrectBestTargets(): void {
    const leafNodeIdxs = this.nodes
      .filter((n) => Object.values(n.children).length === 0)
      .map(n => this.nodeIndices.get(n.blockRoot))
      .filter(notNullish);
    const incorrectBestTargets = leafNodeIdxs.filter(idx => !this.isCandidateForBestTarget(idx));
    // step down as best targets
    incorrectBestTargets.forEach(idx => this.propagateWeightChange(idx, BigInt(0)));
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

        this.propagateWeightChange(this.nodeIndices.getStrict(agg.target), delta);
      }
    });

    this.synced = true;
  }

  public head(): BlockSummary {
    return this.toBlockSummary(this.headNode());
  }

  public headNode(): Node {
    if (this.justified === null) {
      throw Error("Justified checkpoint is null");
    }
    if (this.justified.node === null || this.justified.node.bestTarget === null) {
      throw Error("No best target for justified checkpoint");
    }
    if (!this.synced) {
      this.syncChanges();
    }
    return this.nodes[this.justified.node.bestTarget];
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
    return this.headNode().stateRoot.valueOf() as Uint8Array;
  }

  public getCanonicalBlockSummaryAtSlot(slot: Slot): BlockSummary | null {
    let node = this.headNode();
    if (!node) {
      return null;
    }
    // navigate from the head node, up the chain until either the slot is found or the slot is passed
    while(node.slot !== slot) {
      if (node.slot < slot || node.parent === null) {
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
    return node ? this.toBlockSummary(node) : null;
  }

  public getBlockSummaryByParentBlockRoot(blockRoot: Uint8Array): BlockSummary[] {
    return Object.values(this.nodes)
      .filter((node) => {
        return node.parent !== null
          && this.config.types.Root.equals(
            fromHexString(this.nodes[node.parent].blockRoot),
            blockRoot
          );
      })
      .map(node => this.toBlockSummary(node));
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
    if (this.justified.node && this.getAncestorHex(hexBlockRoot, justifiedSlot) !== this.justified.node.blockRoot) {
      return false;
    }

    return true;
  }

  public getJustified(): Checkpoint {
    if (!this.justified || !this.justified.node) {
      throw Error("Justified checkpoint is null");
    }
    return {root: fromHexString(this.justified.node.blockRoot), epoch: this.justified.epoch};
  }

  public getFinalized(): Checkpoint {
    if (!this.finalized || !this.finalized.node) {
      throw Error("Finalized checkpoint is null");
    }
    return {root: fromHexString(this.finalized.node.blockRoot), epoch: this.finalized.epoch};
  }

  /**
   * Get ancestor of a root until a slot
   * @param root the starting root to look for ancestor
   * @param slot target slot - normally slot < slotOf(root)
   */
  public getAncestor(root: Uint8Array, slot: Slot): Uint8Array | null {
    const ancestor = this.getAncestorHex(toHexString(root), slot);
    return ancestor? fromHexString(ancestor) : null;
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
    if (node.parent !== null) {
      isAddWeight? this.onAddWeight(nodeIndex) : this.onRemoveWeight(nodeIndex);
      this.propagateWeightChange(node.parent, delta);
    }
  }

  /**
   * Check if a leaf is eligible to be a head
   */
  private isCandidateForBestTarget(nodeIndex: number | null): boolean {
    if (nodeIndex === null) return false;
    const node = this.nodes[nodeIndex];
    const justifiedCheckpoint = this.getJustifiedCheckpoint();
    const finalizedCheckpoint = this.getFinalizedCheckpoint();
    if (!justifiedCheckpoint || !finalizedCheckpoint) {
      return true;
    }
    return node.justifiedCheckpoint.epoch === justifiedCheckpoint.epoch &&
    node.justifiedCheckpoint.rootHex === justifiedCheckpoint.rootHex &&
    node.finalizedCheckpoint.epoch === finalizedCheckpoint.epoch &&
    node.finalizedCheckpoint.rootHex === finalizedCheckpoint.rootHex;
  }

  /**
   * Update parent best child / best target in the added weight case
   */
  private onAddWeight(nodeIndex: number): void {
    const node = this.nodes[nodeIndex];
    if (node.parent === null) return;
    const parentNode: Node = this.nodes[node.parent];
    const isFirstBestChild = parentNode.bestChild === null &&
      this.isCandidateForBestTarget(node.bestTarget);
    const needUpdateBestTarget = parentNode.bestChild !== null &&
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
    if (node.parent === null) return;
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
    if (node.parent === null) {
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
  private getJustifiedCheckpoint(): HexCheckpoint | null {
    if (!this.finalized || this.finalized.epoch === GENESIS_EPOCH || !this.justified?.node) {
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
  private getFinalizedCheckpoint(): HexCheckpoint | null {
    if (!this.finalized || this.finalized.epoch === GENESIS_EPOCH || !this.finalized.node) {
      return null;
    }
    return {rootHex: this.finalized.node.blockRoot, epoch: this.finalized.epoch};
  }

  private setFinalized(checkpoint: Checkpoint): {node: Node | null; epoch: Epoch} {
    this.synced = false;
    const rootHex = toHexString(checkpoint.root);
    const idx = this.nodeIndices.get(rootHex);
    this.finalized = {node: idx === null ? null : this.nodes[idx], epoch: checkpoint.epoch};
    this.prune();
    this.aggregator.prune();
    return this.finalized;
  }

  private setJustified(checkpoint: Checkpoint): void {
    const {root: blockRoot, epoch} = checkpoint;
    const rootHex = toHexString(blockRoot);
    const idx = this.nodeIndices.get(rootHex);
    this.justified = {node: idx === null ? null : this.nodes[idx], epoch};
  }

  private getAncestorHex(root: RootHex, slot: Slot): RootHex | null {
    const idx = this.nodeIndices.get(root);
    if (idx === null) {
      return null;
    }
    const node = this.nodes[idx];
    if (node.slot > slot) {
      if (node.parent !== null) {
        const parentNode = this.nodes[node.parent];
        return this.getAncestorHex(parentNode.blockRoot, slot);
      } else {
        return null;
      }
      // return (node.parent !== null)? this.getAncestor(parentNode.blockRoot, slot) : null;
    } else if (node.slot === slot) {
      return node.blockRoot;
    } else {
      // root is older than queried slot, thus a skip slot. Return latest root prior to slot
      return root;
    }
  }

  private prune(): void {
    if (this.finalized && this.finalized.node) {
      const finalizedSlot = this.finalized.node.slot;
      const nodesToDel = this.nodes.filter(node => node.slot < finalizedSlot);
      const blockSummariesToDel = nodesToDel.map(node => this.toBlockSummary(node));
      const blockRootsToDel = nodesToDel.map(node => node.blockRoot);
      const oldNodes = this.nodes;
      this.nodes = this.nodes.filter(node => !blockRootsToDel.includes(node.blockRoot));
      blockRootsToDel.forEach(blockRoot => this.nodeIndices.delete(blockRoot));
      // Update indexes in nodeIndices
      this.nodeIndices = new NodeIndices();
      this.nodes.forEach((node, index) => this.nodeIndices.set(node.blockRoot, index));
      // Update indexes in node
      this.nodes.forEach(node => node.shiftIndex(oldNodes, this.nodeIndices));
      this.finalized.node.parent = NO_NODE;
      this.emit("prune", this.toBlockSummary(this.finalized.node), blockSummariesToDel);
    }
  }

  private toBlockSummary(node: Node): BlockSummary {
    let parentRootBuf: Uint8Array;
    if(node.parent !== null) {
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
