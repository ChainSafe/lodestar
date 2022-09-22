import {Epoch, RootHex, Slot} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {GENESIS_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";

import {ForkChoiceOpts} from "../forkChoice/forkChoice.js";
import {ProtoBlock, ProtoNode, HEX_ZERO_HASH, ExecutionStatus, LVHExecResponse} from "./interface.js";
import {ProtoArrayError, ProtoArrayErrorCode, LVHExecError, LVHExecErrorCode} from "./errors.js";

export const DEFAULT_PRUNE_THRESHOLD = 0;
type ProposerBoost = {root: RootHex; score: number};

const ZERO_HASH_HEX = toHexString(Buffer.alloc(32, 0));

export class ProtoArray {
  // Do not attempt to prune the tree unless it has at least this many nodes.
  // Small prunes simply waste time
  pruneThreshold: number;
  justifiedEpoch: Epoch;
  justifiedRoot: RootHex;
  finalizedEpoch: Epoch;
  finalizedRoot: RootHex;
  nodes: ProtoNode[] = [];
  indices = new Map<RootHex, number>();
  lvhError?: LVHExecError;

  private previousProposerBoost: ProposerBoost | null = null;
  private countUnrealizedFull = false;

  constructor(
    {
      pruneThreshold,
      justifiedEpoch,
      justifiedRoot,
      finalizedEpoch,
      finalizedRoot,
    }: {
      pruneThreshold: number;
      justifiedEpoch: Epoch;
      justifiedRoot: RootHex;
      finalizedEpoch: Epoch;
      finalizedRoot: RootHex;
    },
    opts?: ForkChoiceOpts
  ) {
    this.pruneThreshold = pruneThreshold;
    this.justifiedEpoch = justifiedEpoch;
    this.justifiedRoot = justifiedRoot;
    this.finalizedEpoch = finalizedEpoch;
    this.finalizedRoot = finalizedRoot;
    this.countUnrealizedFull = opts?.countUnrealizedFull ?? false;
  }

  static initialize(block: Omit<ProtoBlock, "targetRoot">, currentSlot: Slot, opts?: ForkChoiceOpts): ProtoArray {
    const protoArray = new ProtoArray(
      {
        pruneThreshold: DEFAULT_PRUNE_THRESHOLD,
        justifiedEpoch: block.justifiedEpoch,
        justifiedRoot: block.justifiedRoot,
        finalizedEpoch: block.finalizedEpoch,
        finalizedRoot: block.finalizedRoot,
      },
      opts
    );
    protoArray.onBlock(
      {
        ...block,
        // We are using the blockROot as the targetRoot, since it always lies on an epoch boundary
        targetRoot: block.blockRoot,
      } as ProtoBlock,
      currentSlot
    );
    return protoArray;
  }

  /**
   * Iterate backwards through the array, touching all nodes and their parents and potentially
   * the best-child of each parent.
   *
   * The structure of the `self.nodes` array ensures that the child of each node is always
   * touched before its parent.
   *
   * For each node, the following is done:
   *
   * - Update the node's weight with the corresponding delta.
   * - Back-propagate each node's delta to its parents delta.
   * - Compare the current node with the parents best-child, updating it if the current node
   * should become the best child.
   * - If required, update the parents best-descendant with the current node or its best-descendant.
   */
  applyScoreChanges({
    deltas,
    proposerBoost,
    justifiedEpoch,
    justifiedRoot,
    finalizedEpoch,
    finalizedRoot,
    currentSlot,
  }: {
    deltas: number[];
    proposerBoost: ProposerBoost | null;
    justifiedEpoch: Epoch;
    justifiedRoot: RootHex;
    finalizedEpoch: Epoch;
    finalizedRoot: RootHex;
    currentSlot: Slot;
  }): void {
    if (deltas.length !== this.indices.size) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_DELTA_LEN,
        deltas: deltas.length,
        indices: this.indices.size,
      });
    }

    if (
      justifiedEpoch !== this.justifiedEpoch ||
      finalizedEpoch !== this.finalizedEpoch ||
      justifiedRoot !== this.justifiedRoot ||
      finalizedRoot !== this.finalizedRoot
    ) {
      this.justifiedEpoch = justifiedEpoch;
      this.finalizedEpoch = finalizedEpoch;
      this.justifiedRoot = justifiedRoot;
      this.finalizedRoot = finalizedRoot;
    }

    // Iterate backwards through all indices in this.nodes
    for (let nodeIndex = this.nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
      const node = this.nodes[nodeIndex];
      if (node === undefined) {
        throw new ProtoArrayError({
          code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
          index: nodeIndex,
        });
      }

      // There is no need to adjust the balances or manage parent of the zero hash since it
      // is an alias to the genesis block. The weight applied to the genesis block is
      // irrelevant as we _always_ choose it and it's impossible for it to have a parent.
      if (node.blockRoot === HEX_ZERO_HASH) {
        continue;
      }

      const currentBoost = proposerBoost && proposerBoost.root === node.blockRoot ? proposerBoost.score : 0;
      const previousBoost =
        this.previousProposerBoost && this.previousProposerBoost.root === node.blockRoot
          ? this.previousProposerBoost.score
          : 0;

      // If this node's execution status has been marked invalid, then the weight of the node
      // needs to be taken out of consideration after which the node weight will become 0
      // for subsequent iterations of applyScoreChanges
      const nodeDelta =
        node.executionStatus === ExecutionStatus.Invalid
          ? -node.weight
          : deltas[nodeIndex] + currentBoost - previousBoost;

      // Apply the delta to the node
      node.weight += nodeDelta;

      // Update the parent delta (if any)
      const parentIndex = node.parent;
      if (parentIndex !== undefined) {
        const parentDelta = deltas[parentIndex];
        if (parentDelta === undefined) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INVALID_PARENT_DELTA,
            index: parentIndex,
          });
        }

        // back-propagate the nodes delta to its parent
        deltas[parentIndex] += nodeDelta;
      }
    }

    // A second time, iterate backwards through all indices in `this.nodes`.
    //
    // We _must_ perform these functions separate from the weight-updating loop above to ensure
    // that we have a fully coherent set of weights before updating parent
    // best-child/descendant.
    for (let nodeIndex = this.nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
      const node = this.nodes[nodeIndex];
      if (node === undefined) {
        throw new ProtoArrayError({
          code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
          index: nodeIndex,
        });
      }

      // If the node has a parent, try to update its best-child and best-descendant.
      const parentIndex = node.parent;
      if (parentIndex !== undefined) {
        this.maybeUpdateBestChildAndDescendant(parentIndex, nodeIndex, currentSlot);
      }
    }
    // Update the previous proposer boost
    this.previousProposerBoost = proposerBoost;
  }

  /**
   * Register a block with the fork choice.
   *
   * It is only sane to supply an undefined parent for the genesis block
   */
  onBlock(block: ProtoBlock, currentSlot: Slot): void {
    // If the block is already known, simply ignore it
    if (this.indices.has(block.blockRoot)) {
      return;
    }
    if (block.executionStatus === ExecutionStatus.Invalid) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_BLOCK_EXECUTION_STATUS,
        root: block.blockRoot,
      });
    }

    const node: ProtoNode = {
      ...block,
      parent: this.indices.get(block.parentRoot),
      weight: 0,
      bestChild: undefined,
      bestDescendant: undefined,
    };

    let nodeIndex = this.nodes.length;

    this.indices.set(node.blockRoot, nodeIndex);
    this.nodes.push(node);

    let parentIndex = node.parent;
    // If this node is valid, lets propagate the valid status up the chain
    // and throw error if we counter invalid, as this breaks consensus
    if (node.executionStatus === ExecutionStatus.Valid && parentIndex !== undefined) {
      this.propagateValidExecutionStatusByIndex(parentIndex);
    }

    let n: ProtoNode | undefined = node;
    while (parentIndex !== undefined) {
      this.maybeUpdateBestChildAndDescendant(parentIndex, nodeIndex, currentSlot);
      nodeIndex = parentIndex;
      n = this.getNodeByIndex(nodeIndex);
      parentIndex = n?.parent;
    }
  }

  /**
   * Optimistic sync validate till validated latest hash, invalidate any decendant branch
   * if invalidate till hash provided. If consensus fails, this will invalidate entire
   * forkChoice which will throw on any call to findHead
   */
  validateLatestHash(execResponse: LVHExecResponse, currentSlot: Slot): void {
    // Look reverse because its highly likely node with latestValidExecHash is towards the
    // the leaves of the forkchoice
    //
    // We can also implement the index to lookup for exec hash => proto block, but it
    // still needs to be established properly (though is highly likely) than a unique
    // exec hash maps to a unique beacon block.
    // For more context on this please checkout the following conversation:
    // https://github.com/ChainSafe/lodestar/pull/4182#discussion_r914770167

    if (execResponse.executionStatus === ExecutionStatus.Valid) {
      const {latestValidExecHash} = execResponse;
      // We use -1 for denoting not found
      let latestValidHashIndex = -1;

      for (let nodeIndex = this.nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
        if (this.nodes[nodeIndex].executionPayloadBlockHash === latestValidExecHash) {
          latestValidHashIndex = nodeIndex;
          // We found the block corresponding to latestValidHashIndex, exit the loop
          break;
        }
      }

      // We are trying to be as forgiving as possible here because ideally latestValidHashIndex
      // should be found in the forkchoice
      if (latestValidHashIndex >= 0) {
        this.propagateValidExecutionStatusByIndex(latestValidHashIndex);
      }
    } else {
      // In case of invalidation, ideally:
      //  i) Find the invalid payload
      //  ii) Obtain a chain [LVH.child, LVH.child.child, ....., invalid_payload]
      //  iii) Obtain a chain [Last_known_valid_node,  ...., LVH]
      //
      // Mark chain iii) as Valid if LVH is non null but right now LVH can be non null without
      //  gurranteing chain iii) to be valid: for e.g. in following scenario LVH can be returned
      //  as any of SYNCING: SYNCING, SYNCING, SYNCING, INVALID (due to simple check)/
      //  So we currently ignore this chain and hope eventually it gets resolved
      //
      // Mark chain ii) as Invalid if LVH is found and non null, else only invalidate invalid_payload
      // if its in fcU.
      //
      const {invalidateFromBlockHash, latestValidExecHash} = execResponse;
      const invalidateFromIndex = this.indices.get(invalidateFromBlockHash);
      if (invalidateFromIndex === undefined) {
        throw Error(`Unable to find invalidateFromBlockHash=${invalidateFromBlockHash} in forkChoice`);
      }
      const latestValidHashIndex =
        latestValidExecHash !== null ? this.getNodeIndexFromLVH(latestValidExecHash, invalidateFromIndex) : null;
      if (latestValidHashIndex === null) {
        /**
         *  If the LVH is null or not found, represented with latestValidHashIndex=undefined,
         *   then just invalidate the invalid_payload and bug out.
         *
         *   Ideally in not found scenario we should invalidate the entire chain upwards, but
         *   it is possible (and observed in the testnets) that the EL was
         *
         *     i) buggy: that the LVH was not really the parent of the invalid block, but on
         *        some side chain
         *     ii) lazy: that invalidation was result of simple check and the EL just
         *         responded with a bogus LVH
         *
         *   So we will just invalidate the current payload and let future responses take care
         *   to be as robust as possible.
         */
        this.invalidateNodeByIndex(invalidateFromIndex);
      } else {
        this.propagateInValidExecutionStatusByIndex(invalidateFromIndex, latestValidHashIndex, currentSlot);
      }
    }
  }

  private propagateValidExecutionStatusByIndex(validNodeIndex: number): void {
    let nodeIndex: number | undefined = validNodeIndex;
    // propagate till we keep encountering syncing status
    while (nodeIndex !== undefined) {
      const node = this.getNodeFromIndex(nodeIndex);
      if (node.executionStatus === ExecutionStatus.PreMerge || node.executionStatus === ExecutionStatus.Valid) {
        break;
      }
      this.validateNodeByIndex(nodeIndex);
      nodeIndex = node.parent;
    }
  }

  /**
   * Do a two pass invalidation:
   *  1. we go up and mark all nodes invalid and then
   *  2. we need do iterate down and mark all children of invalid nodes invalid
   *
   * latestValidHashIndex === undefined implies invalidate only invalidateTillIndex
   * latestValidHashIndex === -1 implies invalidate all post merge blocks
   * latestValidHashIndex >=0 implies invalidate the chain upwards from invalidateTillIndex
   */

  private propagateInValidExecutionStatusByIndex(
    invalidateFromIndex: number,
    latestValidHashIndex: number,
    currentSlot: Slot
  ): void {
    // Pass 1: mark invalidateFromIndex and its parents invalid
    let invalidateIndex: number | undefined = invalidateFromIndex;
    while (invalidateIndex !== undefined && invalidateIndex > latestValidHashIndex) {
      const invalidNode = this.invalidateNodeByIndex(invalidateIndex);
      invalidateIndex = invalidNode.parent;
    }

    // Pass 2: mark all children of invalid nodes as invalid
    for (let nodeIndex = 0; nodeIndex < this.nodes.length; nodeIndex++) {
      const node = this.getNodeFromIndex(nodeIndex);
      const parent = node.parent !== undefined ? this.getNodeByIndex(node.parent) : undefined;
      // Only invalidate if this is post merge, and either parent is invalid or the
      // concensus has failed
      if (parent?.executionStatus === ExecutionStatus.Invalid) {
        // check and flip node status to invalid
        this.invalidateNodeByIndex(nodeIndex);
      }
    }

    // update the forkchoice as the invalidation can change the entire forkchoice DAG
    this.applyScoreChanges({
      deltas: Array.from({length: this.nodes.length}, () => 0),
      proposerBoost: this.previousProposerBoost,
      justifiedEpoch: this.justifiedEpoch,
      justifiedRoot: this.justifiedRoot,
      finalizedEpoch: this.finalizedEpoch,
      finalizedRoot: this.finalizedRoot,
      currentSlot,
    });
  }

  private getNodeIndexFromLVH(latestValidExecHash: RootHex, ancestorOfIndex: number): number | null {
    let nodeIndex = this.nodes[ancestorOfIndex].parent;
    while (nodeIndex !== undefined && nodeIndex >= 0) {
      const node = this.getNodeFromIndex(nodeIndex);
      if (
        (node.executionStatus === ExecutionStatus.PreMerge && latestValidExecHash === ZERO_HASH_HEX) ||
        node.executionPayloadBlockHash === latestValidExecHash
      ) {
        break;
      }
      nodeIndex = node.parent;
    }
    return nodeIndex !== undefined ? nodeIndex : null;
  }

  private invalidateNodeByIndex(nodeIndex: number): ProtoNode {
    const invalidNode = this.getNodeFromIndex(nodeIndex);

    // If node to be invalidated is pre-merge or valid,it is a catastrophe,
    // and indicates consensus failure and a non recoverable damage.
    //
    // There is no further processing that can be done.
    // Just assign error for marking proto-array perma damaged and throw!
    if (
      invalidNode.executionStatus === ExecutionStatus.Valid ||
      invalidNode.executionStatus === ExecutionStatus.PreMerge
    ) {
      const lvhCode =
        invalidNode.executionStatus === ExecutionStatus.Valid
          ? LVHExecErrorCode.ValidToInvalid
          : LVHExecErrorCode.PreMergeToInvalid;

      this.lvhError = {
        lvhCode,
        blockRoot: invalidNode.blockRoot,
        execHash: invalidNode.executionPayloadBlockHash ?? ZERO_HASH_HEX,
      };
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_LVH_EXECUTION_RESPONSE,
        ...this.lvhError,
      });
    }

    invalidNode.executionStatus = ExecutionStatus.Invalid;
    invalidNode.bestChild = undefined;
    invalidNode.bestDescendant = undefined;

    return invalidNode;
  }

  private validateNodeByIndex(nodeIndex: number): ProtoNode {
    const validNode = this.getNodeFromIndex(nodeIndex);
    if (validNode.executionStatus === ExecutionStatus.Invalid) {
      this.lvhError = {
        lvhCode: LVHExecErrorCode.InvalidToValid,
        blockRoot: validNode.blockRoot,
        execHash: validNode.executionPayloadBlockHash,
      };
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_LVH_EXECUTION_RESPONSE,
        ...this.lvhError,
      });
    } else if (validNode.executionStatus === ExecutionStatus.Syncing) {
      validNode.executionStatus = ExecutionStatus.Valid;
    }
    return validNode;
  }

  /**
   * Follows the best-descendant links to find the best-block (i.e., head-block).
   */
  findHead(justifiedRoot: RootHex, currentSlot: Slot): RootHex {
    if (this.lvhError) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_LVH_EXECUTION_RESPONSE,
        ...this.lvhError,
      });
    }

    const justifiedIndex = this.indices.get(justifiedRoot);
    if (justifiedIndex === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.JUSTIFIED_NODE_UNKNOWN,
        root: justifiedRoot,
      });
    }

    const justifiedNode = this.nodes[justifiedIndex];
    if (justifiedNode === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_JUSTIFIED_INDEX,
        index: justifiedIndex,
      });
    }

    if (justifiedNode.executionStatus === ExecutionStatus.Invalid) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_JUSTIFIED_EXECUTION_STATUS,
        root: justifiedNode.blockRoot,
      });
    }

    const bestDescendantIndex = justifiedNode.bestDescendant ?? justifiedIndex;

    const bestNode = this.nodes[bestDescendantIndex];
    if (bestNode === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_BEST_DESCENDANT_INDEX,
        index: bestDescendantIndex,
      });
    }

    /**
     * Perform a sanity check that the node is indeed valid to be the head
     * The justified node is always considered viable for head per spec:
     * def get_head(store: Store) -> Root:
     * blocks = get_filtered_block_tree(store)
     * head = store.justified_checkpoint.root
     */
    if (bestDescendantIndex !== justifiedIndex && !this.nodeIsViableForHead(bestNode, currentSlot)) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_BEST_NODE,
        startRoot: justifiedRoot,
        justifiedEpoch: this.justifiedEpoch,
        finalizedEpoch: this.finalizedEpoch,
        headRoot: justifiedNode.blockRoot,
        headJustifiedEpoch: justifiedNode.justifiedEpoch,
        headFinalizedEpoch: justifiedNode.finalizedEpoch,
      });
    }

    return bestNode.blockRoot;
  }

  /**
   * Update the tree with new finalization information. The tree is only actually pruned if both
   * of the two following criteria are met:
   *
   * - The supplied finalized epoch and root are different to the current values.
   * - The number of nodes in `self` is at least `self.prune_threshold`.
   *
   * # Errors
   *
   * Returns errors if:
   *
   * - The finalized epoch is less than the current one.
   * - The finalized epoch is equal to the current one, but the finalized root is different.
   * - There is some internal error relating to invalid indices inside `this`.
   */
  maybePrune(finalizedRoot: RootHex): ProtoBlock[] {
    const finalizedIndex = this.indices.get(finalizedRoot);
    if (finalizedIndex === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.FINALIZED_NODE_UNKNOWN,
        root: finalizedRoot,
      });
    }

    if (finalizedIndex < this.pruneThreshold) {
      // Pruning at small numbers incurs more cost than benefit
      return [];
    }

    // Remove the this.indices key/values for all the to-be-deleted nodes
    for (let nodeIndex = 0; nodeIndex < finalizedIndex; nodeIndex++) {
      const node = this.nodes[nodeIndex];
      if (node === undefined) {
        throw new ProtoArrayError({code: ProtoArrayErrorCode.INVALID_NODE_INDEX, index: nodeIndex});
      }
      this.indices.delete(node.blockRoot);
    }

    // Store nodes prior to finalization
    const removed = this.nodes.slice(0, finalizedIndex);
    // Drop all the nodes prior to finalization
    this.nodes = this.nodes.slice(finalizedIndex);

    // Adjust the indices map
    for (const [key, value] of this.indices.entries()) {
      if (value < finalizedIndex) {
        throw new ProtoArrayError({
          code: ProtoArrayErrorCode.INDEX_OVERFLOW,
          value: "indices",
        });
      }
      this.indices.set(key, value - finalizedIndex);
    }

    // Iterate through all the existing nodes and adjust their indices to match the new layout of this.nodes
    for (let i = 0, len = this.nodes.length; i < len; i++) {
      const node = this.nodes[i];
      const parentIndex = node.parent;
      if (parentIndex !== undefined) {
        // If node.parent is less than finalizedIndex, set it to undefined
        node.parent = parentIndex < finalizedIndex ? undefined : parentIndex - finalizedIndex;
      }
      const bestChild = node.bestChild;
      if (bestChild !== undefined) {
        if (bestChild < finalizedIndex) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INDEX_OVERFLOW,
            value: "bestChild",
          });
        }
        node.bestChild = bestChild - finalizedIndex;
      }
      const bestDescendant = node.bestDescendant;
      if (bestDescendant !== undefined) {
        if (bestDescendant < finalizedIndex) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INDEX_OVERFLOW,
            value: "bestDescendant",
          });
        }
        node.bestDescendant = bestDescendant - finalizedIndex;
      }
    }
    return removed;
  }

  /**
   * Observe the parent at `parent_index` with respect to the child at `child_index` and
   * potentially modify the `parent.best_child` and `parent.best_descendant` values.
   *
   * ## Detail
   *
   * There are four outcomes:
   *
   * - The child is already the best child but it's now invalid due to a FFG change and should be removed.
   * - The child is already the best child and the parent is updated with the new
   * best-descendant.
   * - The child is not the best child but becomes the best child.
   * - The child is not the best child and does not become the best child.
   */
  maybeUpdateBestChildAndDescendant(parentIndex: number, childIndex: number, currentSlot: Slot): void {
    const childNode = this.nodes[childIndex];
    if (childNode === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: childIndex,
      });
    }

    const parentNode = this.nodes[parentIndex];
    if (parentNode === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: parentIndex,
      });
    }

    const childLeadsToViableHead = this.nodeLeadsToViableHead(childNode, currentSlot);

    // These three variables are aliases to the three options that we may set the
    // parent.bestChild and parent.bestDescendent to.
    //
    // Aliases are used to assist readability.
    type ChildAndDescendant = [number | undefined, number | undefined];
    const changeToNull: ChildAndDescendant = [undefined, undefined];
    const changeToChild: ChildAndDescendant = [childIndex, childNode.bestDescendant ?? childIndex];
    const noChange: ChildAndDescendant = [parentNode.bestChild, parentNode.bestDescendant];

    let newChildAndDescendant: ChildAndDescendant;
    const bestChildIndex = parentNode.bestChild;
    if (bestChildIndex !== undefined) {
      if (bestChildIndex === childIndex && !childLeadsToViableHead) {
        // the child is already the best-child of the parent but its not viable for the head
        // so remove it
        newChildAndDescendant = changeToNull;
      } else if (bestChildIndex === childIndex) {
        // the child is the best-child already
        // set it again to ensure that the best-descendent of the parent is updated
        newChildAndDescendant = changeToChild;
      } else {
        const bestChildNode = this.nodes[bestChildIndex];
        if (bestChildNode === undefined) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INVALID_BEST_CHILD_INDEX,
            index: bestChildIndex,
          });
        }

        const bestChildLeadsToViableHead = this.nodeLeadsToViableHead(bestChildNode, currentSlot);

        if (childLeadsToViableHead && !bestChildLeadsToViableHead) {
          // the child leads to a viable head, but the current best-child doesn't
          newChildAndDescendant = changeToChild;
        } else if (!childLeadsToViableHead && bestChildLeadsToViableHead) {
          // the best child leads to a viable head but the child doesn't
          newChildAndDescendant = noChange;
        } else if (childNode.weight === bestChildNode.weight) {
          // tie-breaker of equal weights by root
          if (childNode.blockRoot >= bestChildNode.blockRoot) {
            newChildAndDescendant = changeToChild;
          } else {
            newChildAndDescendant = noChange;
          }
        } else {
          // choose the winner by weight
          if (childNode.weight >= bestChildNode.weight) {
            newChildAndDescendant = changeToChild;
          } else {
            newChildAndDescendant = noChange;
          }
        }
      }
    } else if (childLeadsToViableHead) {
      // There is no current best-child and the child is viable.
      newChildAndDescendant = changeToChild;
    } else {
      // There is no current best-child but the child is not viable.
      newChildAndDescendant = noChange;
    }

    parentNode.bestChild = newChildAndDescendant[0];
    parentNode.bestDescendant = newChildAndDescendant[1];
  }

  /**
   * Indicates if the node itself is viable for the head, or if it's best descendant is viable
   * for the head.
   */
  nodeLeadsToViableHead(node: ProtoNode, currentSlot: Slot): boolean {
    let bestDescendantIsViableForHead: boolean;
    const bestDescendantIndex = node.bestDescendant;
    if (bestDescendantIndex !== undefined) {
      const bestDescendantNode = this.nodes[bestDescendantIndex];
      if (bestDescendantNode === undefined) {
        throw new ProtoArrayError({
          code: ProtoArrayErrorCode.INVALID_BEST_DESCENDANT_INDEX,
          index: bestDescendantIndex,
        });
      }
      bestDescendantIsViableForHead = this.nodeIsViableForHead(bestDescendantNode, currentSlot);
    } else {
      bestDescendantIsViableForHead = false;
    }

    return bestDescendantIsViableForHead || this.nodeIsViableForHead(node, currentSlot);
  }

  /**
   * This is the equivalent to the `filter_block_tree` function in the Ethereum Consensus spec:
   *
   * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/fork-choice.md#filter_block_tree
   *
   * Any node that has a different finalized or justified epoch should not be viable for the
   * head.
   */
  nodeIsViableForHead(node: ProtoNode, currentSlot: Slot): boolean {
    // If node has invalid executionStatus, it can't be a viable head
    if (node.executionStatus === ExecutionStatus.Invalid) {
      return false;
    }
    const currentEpoch = computeEpochAtSlot(currentSlot);
    const previousEpoch = currentEpoch - 1;

    // If block is from a previous epoch, filter using unrealized justification & finalization information
    // If block is from the current epoch, filter using the head state's justification & finalization information
    const isFromPrevEpoch = computeEpochAtSlot(node.slot) < currentEpoch;
    const nodeJustifiedEpoch = isFromPrevEpoch ? node.unrealizedJustifiedEpoch : node.justifiedEpoch;
    const nodeJustifiedRoot = isFromPrevEpoch ? node.unrealizedJustifiedRoot : node.justifiedRoot;
    const nodeFinalizedEpoch = isFromPrevEpoch ? node.unrealizedFinalizedEpoch : node.finalizedEpoch;
    const nodeFinalizedRoot = isFromPrevEpoch ? node.unrealizedFinalizedRoot : node.finalizedRoot;

    // If previous epoch is justified, pull up all tips to at least the previous epoch
    if (this.countUnrealizedFull && currentEpoch > GENESIS_EPOCH && this.justifiedEpoch === previousEpoch) {
      return node.unrealizedJustifiedEpoch >= previousEpoch;
      // If previous epoch is not justified, pull up only tips from past epochs up to the current epoch
    } else {
      const correctJustified =
        (nodeJustifiedEpoch === this.justifiedEpoch && nodeJustifiedRoot === this.justifiedRoot) ||
        this.justifiedEpoch === 0;
      const correctFinalized =
        (nodeFinalizedEpoch === this.finalizedEpoch && nodeFinalizedRoot === this.finalizedRoot) ||
        this.finalizedEpoch === 0;
      return correctJustified && correctFinalized;
    }
  }

  /**
   * Iterate from a block root backwards over nodes
   */
  *iterateAncestorNodes(blockRoot: RootHex): IterableIterator<ProtoNode> {
    const startIndex = this.indices.get(blockRoot);
    if (startIndex === undefined) {
      return;
    }

    const node = this.nodes[startIndex];
    if (node === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: startIndex,
      });
    }

    yield* this.iterateAncestorNodesFromNode(node);
  }

  /**
   * Iterate from a block root backwards over nodes
   */
  *iterateAncestorNodesFromNode(node: ProtoNode): IterableIterator<ProtoNode> {
    while (node.parent !== undefined) {
      node = this.getNodeFromIndex(node.parent);
      yield node;
    }
  }

  /**
   * Get all nodes from a block root backwards
   */
  getAllAncestorNodes(blockRoot: RootHex): ProtoNode[] {
    const startIndex = this.indices.get(blockRoot);
    if (startIndex === undefined) {
      return [];
    }

    let node = this.nodes[startIndex];
    if (node === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: startIndex,
      });
    }

    const nodes = [node];

    while (node.parent !== undefined) {
      node = this.getNodeFromIndex(node.parent);
      nodes.push(node);
    }

    return nodes;
  }

  /**
   * The opposite of iterateNodes.
   * iterateNodes is to find ancestor nodes of a blockRoot.
   * this is to find non-ancestor nodes of a blockRoot.
   */
  getAllNonAncestorNodes(blockRoot: RootHex): ProtoNode[] {
    const startIndex = this.indices.get(blockRoot);
    if (startIndex === undefined) {
      return [];
    }

    let node = this.nodes[startIndex];
    if (node === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: startIndex,
      });
    }
    const result: ProtoNode[] = [];
    let nodeIndex = startIndex;
    while (node.parent !== undefined) {
      const parentIndex = node.parent;
      node = this.getNodeFromIndex(parentIndex);
      // nodes between nodeIndex and parentIndex means non-ancestor nodes
      result.push(...this.getNodesBetween(nodeIndex, parentIndex));
      nodeIndex = parentIndex;
    }
    result.push(...this.getNodesBetween(nodeIndex, 0));
    return result;
  }

  hasBlock(blockRoot: RootHex): boolean {
    return this.indices.has(blockRoot);
  }

  getNode(blockRoot: RootHex): ProtoNode | undefined {
    const blockIndex = this.indices.get(blockRoot);
    if (blockIndex === undefined) {
      return undefined;
    }
    return this.getNodeByIndex(blockIndex);
  }

  /** Return MUTABLE ProtoBlock for blockRoot (spreads properties) */
  getBlock(blockRoot: RootHex): ProtoBlock | undefined {
    const node = this.getNode(blockRoot);
    if (!node) {
      return undefined;
    }
    return {
      ...node,
    };
  }

  /** Return NON-MUTABLE ProtoBlock for blockRoot (does not spread properties) */
  getBlockReadonly(blockRoot: RootHex): ProtoBlock {
    const node = this.getNode(blockRoot);
    if (!node) {
      throw Error(`No block for root ${blockRoot}`);
    }
    return node;
  }

  /**
   * Returns `true` if the `descendantRoot` has an ancestor with `ancestorRoot`.
   * Always returns `false` if either input roots are unknown.
   * Still returns `true` if `ancestorRoot` === `descendantRoot` (and the roots are known)
   */
  isDescendant(ancestorRoot: RootHex, descendantRoot: RootHex): boolean {
    const ancestorNode = this.getNode(ancestorRoot);
    if (!ancestorNode) {
      return false;
    }

    if (ancestorRoot === descendantRoot) {
      return true;
    }

    for (const node of this.iterateAncestorNodes(descendantRoot)) {
      if (node.slot < ancestorNode.slot) {
        return false;
      }
      if (node.blockRoot === ancestorNode.blockRoot) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns a common ancestor for nodeA or nodeB or null if there's none
   */
  getCommonAncestor(nodeA: ProtoNode, nodeB: ProtoNode): ProtoNode | null {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // If nodeA is higher than nodeB walk up nodeA tree
      if (nodeA.slot > nodeB.slot) {
        if (nodeA.parent === undefined) {
          return null;
        }

        nodeA = this.getNodeFromIndex(nodeA.parent);
      }

      // If nodeB is higher than nodeA walk up nodeB tree
      else if (nodeA.slot < nodeB.slot) {
        if (nodeB.parent === undefined) {
          return null;
        }

        nodeB = this.getNodeFromIndex(nodeB.parent);
      }

      // If both node trees are at the same height, if same root == common ancestor.
      // Otherwise, keep walking up until there's a match or no parent.
      else {
        if (nodeA.blockRoot === nodeB.blockRoot) {
          return nodeA;
        }

        if (nodeA.parent === undefined || nodeB.parent === undefined) {
          return null;
        }

        nodeA = this.getNodeFromIndex(nodeA.parent);
        nodeB = this.getNodeFromIndex(nodeB.parent);
      }
    }
  }

  length(): number {
    return this.indices.size;
  }

  private getNodeFromIndex(index: number): ProtoNode {
    const node = this.nodes[index];
    if (node === undefined) {
      throw new ProtoArrayError({code: ProtoArrayErrorCode.INVALID_NODE_INDEX, index});
    }
    return node;
  }

  private getNodeByIndex(blockIndex: number): ProtoNode | undefined {
    const node = this.nodes[blockIndex];
    if (node === undefined) {
      return undefined;
    }

    return node;
  }

  private getNodesBetween(upperIndex: number, lowerIndex: number): ProtoNode[] {
    const result = [];
    for (let index = upperIndex - 1; index > lowerIndex; index--) {
      const node = this.nodes[index];
      if (node === undefined) {
        throw new ProtoArrayError({
          code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
          index,
        });
      }
      result.push(node);
    }
    return result;
  }
}
