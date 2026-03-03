import {GENESIS_EPOCH, PTC_SIZE} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ForkChoiceError, ForkChoiceErrorCode} from "../forkChoice/errors.js";
import {LVHExecError, LVHExecErrorCode, ProtoArrayError, ProtoArrayErrorCode} from "./errors.js";
import {
  ExecutionStatus,
  HEX_ZERO_HASH,
  LVHExecResponse,
  PayloadStatus,
  ProtoBlock,
  ProtoNode,
  isGloasBlock,
} from "./interface.js";

/**
 * Threshold for payload timeliness (>50% of PTC must vote)
 * Spec: gloas/fork-choice.md (PAYLOAD_TIMELY_THRESHOLD = PTC_SIZE // 2)
 */
const PAYLOAD_TIMELY_THRESHOLD = Math.floor(PTC_SIZE / 2);

export const DEFAULT_PRUNE_THRESHOLD = 0;
type ProposerBoost = {root: RootHex; score: number};

const ZERO_HASH_HEX = toRootHex(Buffer.alloc(32, 0));

/** Pre-Gloas: single element, FULL index (for backward compatibility) */
type PreGloasVariantIndex = number;
/**
 * Post-Gloas: array length is 2 or 3
 *   - Length 2: [PENDING_INDEX, EMPTY_INDEX] when payload hasn't arrived yet
 *   - Length 3: [PENDING_INDEX, EMPTY_INDEX, FULL_INDEX] when payload has arrived
 */
type GloasVariantIndices = [number, number] | [number, number, number];
type VariantIndices = PreGloasVariantIndex | GloasVariantIndices;

export class ProtoArray {
  // Do not attempt to prune the tree unless it has at least this many nodes.
  // Small prunes simply waste time
  pruneThreshold: number;
  justifiedEpoch: Epoch;
  justifiedRoot: RootHex;
  finalizedEpoch: Epoch;
  finalizedRoot: RootHex;
  nodes: ProtoNode[] = [];
  /**
   * Maps block root to array of node indices for each payload status variant
   *
   * Array structure: [PENDING, EMPTY, FULL] where indices correspond to PayloadStatus enum values
   * - number[0] = PENDING variant index (PayloadStatus.PENDING = 0)
   * - number[1] = EMPTY variant index (PayloadStatus.EMPTY = 1)
   * - number[2] = FULL variant index (PayloadStatus.FULL = 2)
   *
   * Note: undefined array elements indicate that variant doesn't exist for this block
   */
  indices = new Map<RootHex, VariantIndices>();
  lvhError?: LVHExecError;

  private previousProposerBoost: ProposerBoost | null = null;

  /**
   * PTC (Payload Timeliness Committee) votes per block
   * Maps block root to boolean array of size PTC_SIZE (from params: 512 mainnet, 2 minimal)
   * Spec: gloas/fork-choice.md#modified-store (line 148)
   *
   * ptcVotes[blockRoot][i] = true if PTC member i voted payload_present=true
   * Used by is_payload_timely() to determine if payload is timely
   */
  private ptcVotes = new Map<RootHex, boolean[]>();

  constructor({
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
  }) {
    this.pruneThreshold = pruneThreshold;
    this.justifiedEpoch = justifiedEpoch;
    this.justifiedRoot = justifiedRoot;
    this.finalizedEpoch = finalizedEpoch;
    this.finalizedRoot = finalizedRoot;
  }

  static initialize(block: Omit<ProtoBlock, "targetRoot">, currentSlot: Slot): ProtoArray {
    const protoArray = new ProtoArray({
      pruneThreshold: DEFAULT_PRUNE_THRESHOLD,
      justifiedEpoch: block.justifiedEpoch,
      justifiedRoot: block.justifiedRoot,
      finalizedEpoch: block.finalizedEpoch,
      finalizedRoot: block.finalizedRoot,
    });
    protoArray.onBlock(
      {
        ...block,
        // We are using the blockROot as the targetRoot, since it always lies on an epoch boundary
        targetRoot: block.blockRoot,
      } as ProtoBlock,
      currentSlot,
      null
    );
    return protoArray;
  }

  /**
   * Get node index for a block root and payload status
   *
   * @param root - The block root to look up
   * @param payloadStatus - The specific payload status variant (PENDING/EMPTY/FULL)
   * @returns The node index for the specified variant, or undefined if not found
   *
   * Behavior:
   * - Pre-Gloas blocks: only FULL is valid, PENDING/EMPTY throw error
   * - Gloas blocks: returns the specified variant index, or undefined if that variant doesn't exist
   *
   * Note: payloadStatus is required. Use getDefaultVariant() to get the canonical variant.
   */
  getNodeIndexByRootAndStatus(root: RootHex, payloadStatus: PayloadStatus): number | undefined {
    const variantOrArr = this.indices.get(root);
    if (variantOrArr == null) {
      return undefined;
    }

    // Pre-Gloas: only FULL variant exists
    if (!Array.isArray(variantOrArr)) {
      // Return FULL variant if no status specified or FULL explicitly requested
      if (payloadStatus === PayloadStatus.FULL) {
        return variantOrArr;
      }
      // PENDING and EMPTY are invalid for pre-Gloas blocks
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: payloadStatus,
      });
    }

    // Gloas: return the specified variant, or PENDING if not specified
    return variantOrArr[payloadStatus];
  }

  /**
   * Get the default/canonical payload status for a block root
   * - Pre-Gloas blocks: Returns FULL (payload embedded in block)
   * - Gloas blocks: Returns PENDING (canonical variant)
   *
   * @param blockRoot - The block root to check
   * @returns PayloadStatus.FULL for pre-Gloas, PayloadStatus.PENDING for Gloas, undefined if block not found
   */
  getDefaultVariant(blockRoot: RootHex): PayloadStatus | undefined {
    const variantOrArr = this.indices.get(blockRoot);
    if (variantOrArr == null) {
      return undefined;
    }

    // Pre-Gloas: only FULL variant exists
    if (!Array.isArray(variantOrArr)) {
      return PayloadStatus.FULL;
    }

    // Gloas: multiple variants exist, PENDING is canonical
    return PayloadStatus.PENDING;
  }

  /**
   * Determine which parent payload status a block extends
   * Spec: gloas/fork-choice.md#new-get_parent_payload_status
   *   def get_parent_payload_status(store: Store, block: BeaconBlock) -> PayloadStatus:
   *     parent = store.blocks[block.parent_root]
   *     parent_block_hash = block.body.signed_execution_payload_bid.message.parent_block_hash
   *     message_block_hash = parent.body.signed_execution_payload_bid.message.block_hash
   *     return PAYLOAD_STATUS_FULL if parent_block_hash == message_block_hash else PAYLOAD_STATUS_EMPTY
   *
   * In lodestar forkchoice, we don't store the full bid, so we compares parent_block_hash in child's bid with executionPayloadBlockHash in parent:
   * - If it matches EMPTY variant, return EMPTY
   * - If it matches FULL variant, return FULL
   * - If no match, throw UNKNOWN_PARENT_BLOCK error
   *
   * For pre-Gloas blocks: always returns FULL
   */
  getParentPayloadStatus(block: ProtoBlock): PayloadStatus {
    // Pre-Gloas blocks have payloads embedded, so parents are always FULL
    const {parentBlockHash} = block;
    if (parentBlockHash === null) {
      return PayloadStatus.FULL;
    }

    const parentBlock = this.getBlockHexAndBlockHash(block.parentRoot, parentBlockHash);
    if (parentBlock == null) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.UNKNOWN_PARENT_BLOCK,
        parentRoot: block.parentRoot,
        parentHash: parentBlockHash,
      });
    }

    return parentBlock.payloadStatus;
  }

  /**
   * Return the parent `ProtoBlock` given its root and block hash.
   */
  getParent(parentRoot: RootHex, parentBlockHash: RootHex | null): ProtoBlock | null {
    // pre-gloas
    if (parentBlockHash === null) {
      const parentIndex = this.indices.get(parentRoot);
      if (parentIndex === undefined) {
        return null;
      }
      if (Array.isArray(parentIndex)) {
        // Gloas block found when pre-gloas expected
        throw new ProtoArrayError({
          code: ProtoArrayErrorCode.UNKNOWN_PARENT_BLOCK,
          parentRoot,
          parentHash: parentBlockHash,
        });
      }
      return this.nodes[parentIndex] ?? null;
    }

    // post-gloas
    return this.getBlockHexAndBlockHash(parentRoot, parentBlockHash);
  }

  /**
   * Returns an EMPTY or FULL `ProtoBlock` that has matching block root and block hash
   */
  getBlockHexAndBlockHash(blockRoot: RootHex, blockHash: RootHex): ProtoBlock | null {
    const variantIndices = this.indices.get(blockRoot);
    if (variantIndices === undefined) {
      return null;
    }

    // Pre-Gloas
    if (!Array.isArray(variantIndices)) {
      const node = this.nodes[variantIndices];
      return node.executionPayloadBlockHash === blockHash ? node : null;
    }

    // Post-Gloas, check empty and full variants
    const fullNodeIndex = variantIndices[PayloadStatus.FULL];
    if (fullNodeIndex !== undefined) {
      const fullNode = this.nodes[fullNodeIndex];
      if (fullNode && fullNode.executionPayloadBlockHash === blockHash) {
        return fullNode;
      }
    }

    const emptyNode = this.nodes[variantIndices[PayloadStatus.EMPTY]];
    if (emptyNode && emptyNode.executionPayloadBlockHash === blockHash) {
      return emptyNode;
    }

    // PENDING is the same to EMPTY so not likely we can return it
    // also it's only specific for fork-choice

    return null;
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
    if (deltas.length !== this.nodes.length) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_DELTA_LEN,
        deltas: deltas.length,
        indices: this.nodes.length,
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
        this.maybeUpdateBestChildAndDescendant(parentIndex, nodeIndex, currentSlot, proposerBoost?.root ?? null);
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
  onBlock(block: ProtoBlock, currentSlot: Slot, proposerBoostRoot: RootHex | null): void {
    // If the block is already known, simply ignore it
    if (this.hasBlock(block.blockRoot)) {
      return;
    }
    if (block.executionStatus === ExecutionStatus.Invalid) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_BLOCK_EXECUTION_STATUS,
        root: block.blockRoot,
      });
    }

    if (isGloasBlock(block)) {
      // Gloas: Create PENDING + EMPTY nodes with correct parent relationships
      // Parent of new PENDING node = parent block's EMPTY or FULL (inter-block edge)
      // Parent of new EMPTY node = own PENDING node (intra-block edge)

      // For fork transition: if parent is pre-Gloas, point to parent's FULL
      // Otherwise, determine which parent payload status this block extends
      let parentIndex: number | undefined;

      // Check if parent exists by getting variants array
      const parentVariants = this.indices.get(block.parentRoot);
      if (parentVariants != null) {
        const anyParentIndex = Array.isArray(parentVariants) ? parentVariants[0] : parentVariants;
        const anyParentNode = this.nodes[anyParentIndex];

        if (!isGloasBlock(anyParentNode)) {
          // Fork transition: parent is pre-Gloas, so it only has FULL variant at variants[0]
          parentIndex = anyParentIndex;
        } else {
          // Both blocks are Gloas: determine which parent payload status to extend
          const parentPayloadStatus = this.getParentPayloadStatus(block);
          parentIndex = this.getNodeIndexByRootAndStatus(block.parentRoot, parentPayloadStatus);
        }
      }
      // else: parent doesn't exist, parentIndex remains undefined (orphan block)

      // Create PENDING node
      const pendingNode: ProtoNode = {
        ...block,
        parent: parentIndex, // Points to parent's EMPTY/FULL or FULL (for transition)
        payloadStatus: PayloadStatus.PENDING,
        weight: 0,
        bestChild: undefined,
        bestDescendant: undefined,
      };

      const pendingIndex = this.nodes.length;
      this.nodes.push(pendingNode);

      // Create EMPTY variant as a child of PENDING
      const emptyNode: ProtoNode = {
        ...block,
        parent: pendingIndex, // Points to own PENDING
        payloadStatus: PayloadStatus.EMPTY,
        weight: 0,
        bestChild: undefined,
        bestDescendant: undefined,
      };

      const emptyIndex = this.nodes.length;
      this.nodes.push(emptyNode);

      // Store both variants in the indices array
      // [PENDING, EMPTY, undefined] - FULL will be added later if payload arrives
      this.indices.set(block.blockRoot, [pendingIndex, emptyIndex]);

      // Update bestChild pointers
      if (parentIndex !== undefined) {
        this.maybeUpdateBestChildAndDescendant(parentIndex, pendingIndex, currentSlot, proposerBoostRoot);

        if (pendingNode.executionStatus === ExecutionStatus.Valid) {
          this.propagateValidExecutionStatusByIndex(parentIndex);
        }
      }

      // Update bestChild for PENDING → EMPTY edge
      this.maybeUpdateBestChildAndDescendant(pendingIndex, emptyIndex, currentSlot, proposerBoostRoot);

      // Initialize PTC votes for this block (all false initially)
      // Spec: gloas/fork-choice.md#modified-on_block (line 645)
      this.ptcVotes.set(block.blockRoot, new Array(PTC_SIZE).fill(false));
    } else {
      // Pre-Gloas: Only create FULL node (payload embedded in block)
      const node: ProtoNode = {
        ...block,
        parent: this.getNodeIndexByRootAndStatus(block.parentRoot, PayloadStatus.FULL),
        payloadStatus: PayloadStatus.FULL,
        weight: 0,
        bestChild: undefined,
        bestDescendant: undefined,
      };

      const nodeIndex = this.nodes.length;
      this.nodes.push(node);

      // Pre-Gloas: store FULL index instead of array
      this.indices.set(block.blockRoot, nodeIndex);

      // If this node is valid, lets propagate the valid status up the chain
      // and throw error if we counter invalid, as this breaks consensus
      if (node.parent !== undefined) {
        this.maybeUpdateBestChildAndDescendant(node.parent, nodeIndex, currentSlot, proposerBoostRoot);

        if (node.executionStatus === ExecutionStatus.Valid) {
          this.propagateValidExecutionStatusByIndex(node.parent);
        }
      }
    }
  }

  /**
   * Called when an execution payload is received for a block (Gloas only)
   * Creates a FULL variant node as a sibling to the existing EMPTY variant
   * Both EMPTY and FULL have parent = own PENDING node
   *
   * Spec: gloas/fork-choice.md (on_execution_payload event)
   */
  onExecutionPayload(
    blockRoot: RootHex,
    currentSlot: Slot,
    executionPayloadBlockHash: RootHex,
    executionPayloadNumber: number,
    executionPayloadStateRoot: RootHex,
    proposerBoostRoot: RootHex | null
  ): void {
    // First check if block exists
    const variants = this.indices.get(blockRoot);
    if (variants == null) {
      // Equivalent to `assert envelope.beacon_block_root in store.block_states`
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.UNKNOWN_BLOCK,
        root: blockRoot,
      });
    }

    if (!Array.isArray(variants)) {
      // Pre-gloas block should not be calling this method
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.PRE_GLOAS_BLOCK,
        root: blockRoot,
      });
    }

    // Check if FULL already exists for Gloas blocks
    if (variants[PayloadStatus.FULL] !== undefined) {
      return;
    }

    // Get PENDING node for Gloas blocks
    const pendingIndex = variants[PayloadStatus.PENDING];
    if (pendingIndex === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.UNKNOWN_BLOCK,
        root: blockRoot,
      });
    }

    const pendingNode = this.nodes[pendingIndex];
    if (!pendingNode) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: pendingIndex,
      });
    }

    // Create FULL variant as a child of PENDING (sibling to EMPTY)
    const fullNode: ProtoNode = {
      ...pendingNode,
      parent: pendingIndex, // Points to own PENDING (same as EMPTY)
      payloadStatus: PayloadStatus.FULL,
      weight: 0,
      bestChild: undefined,
      bestDescendant: undefined,
      executionStatus: ExecutionStatus.Valid,
      executionPayloadBlockHash,
      executionPayloadNumber,
      stateRoot: executionPayloadStateRoot,
    };

    const fullIndex = this.nodes.length;
    this.nodes.push(fullNode);

    // Add FULL variant to the indices array
    variants[PayloadStatus.FULL] = fullIndex;

    // Update bestChild for PENDING node (may now prefer FULL over EMPTY)
    this.maybeUpdateBestChildAndDescendant(pendingIndex, fullIndex, currentSlot, proposerBoostRoot);
  }

  /**
   * Update PTC votes for multiple validators attesting to a block
   * Spec: gloas/fork-choice.md#new-on_payload_attestation_message
   *
   * @param blockRoot - The beacon block root being attested
   * @param ptcIndices - Array of PTC committee indices that voted (0..PTC_SIZE-1)
   * @param payloadPresent - Whether the validators attest the payload is present
   */
  notifyPtcMessages(blockRoot: RootHex, ptcIndices: number[], payloadPresent: boolean): void {
    const votes = this.ptcVotes.get(blockRoot);
    if (votes === undefined) {
      // Block not found or not a Gloas block, ignore
      return;
    }

    for (const ptcIndex of ptcIndices) {
      if (ptcIndex < 0 || ptcIndex >= PTC_SIZE) {
        throw new Error(`Invalid PTC index: ${ptcIndex}, must be 0..${PTC_SIZE - 1}`);
      }

      // Update the vote
      votes[ptcIndex] = payloadPresent;
    }
  }

  /**
   * Check if execution payload for a block is timely
   * Spec: gloas/fork-choice.md#new-is_payload_timely
   *
   * Returns true if:
   * 1. Block has PTC votes tracked
   * 2. Payload is locally available (FULL variant exists in proto array)
   * 3. More than PAYLOAD_TIMELY_THRESHOLD (>50% of PTC) members voted payload_present=true
   *
   * @param blockRoot - The beacon block root to check
   */
  isPayloadTimely(blockRoot: RootHex): boolean {
    const votes = this.ptcVotes.get(blockRoot);
    if (votes === undefined) {
      // Block not found or not a Gloas block
      return false;
    }

    // If payload is not locally available, it's not timely
    // In our implementation, payload is locally available if proto array has FULL variant of the block
    const fullNodeIndex = this.getNodeIndexByRootAndStatus(blockRoot, PayloadStatus.FULL);
    if (fullNodeIndex === undefined) {
      return false;
    }

    // Count votes for payload_present=true
    const yesVotes = votes.filter((v) => v).length;
    return yesVotes > PAYLOAD_TIMELY_THRESHOLD;
  }

  /**
   * Check if parent node is FULL
   * Spec: gloas/fork-choice.md#new-is_parent_node_full
   *
   * Returns true if the parent payload status (determined by block.parentBlockHash) is FULL
   */
  isParentNodeFull(block: ProtoBlock): boolean {
    return this.getParentPayloadStatus(block) === PayloadStatus.FULL;
  }

  /**
   * Determine if we should extend the payload (prefer FULL over EMPTY)
   * Spec: gloas/fork-choice.md#new-should_extend_payload
   *
   * Returns true if:
   * 1. Payload is timely, OR
   * 2. No proposer boost root (empty/zero hash), OR
   * 3. Proposer boost root's parent is not this block, OR
   * 4. Proposer boost root extends FULL parent
   *
   * @param blockRoot - The block root to check
   * @param proposerBoostRoot - Current proposer boost root (from ForkChoice)
   */
  shouldExtendPayload(blockRoot: RootHex, proposerBoostRoot: RootHex | null): boolean {
    // Condition 1: Payload is timely
    if (this.isPayloadTimely(blockRoot)) {
      return true;
    }

    // Condition 2: No proposer boost root
    if (proposerBoostRoot === null || proposerBoostRoot === HEX_ZERO_HASH) {
      return true;
    }

    // Get proposer boost block
    // We don't care about variant here, just need proposer boost block info
    const defaultStatus = this.getDefaultVariant(proposerBoostRoot);
    const proposerBoostBlock = defaultStatus !== undefined ? this.getNode(proposerBoostRoot, defaultStatus) : undefined;
    if (!proposerBoostBlock) {
      // Proposer boost block not found, default to extending payload
      return true;
    }

    // Condition 3: Proposer boost root's parent is not this block
    if (proposerBoostBlock.parentRoot !== blockRoot) {
      return true;
    }

    // Condition 4: Proposer boost root extends FULL parent
    if (this.isParentNodeFull(proposerBoostBlock)) {
      return true;
    }

    return false;
  }

  /**
   * Optimistic sync validate till validated latest hash, invalidate any descendant branch
   * if invalidate till hash provided. If consensus fails, this will invalidate entire
   * forkChoice which will throw on any call to findHead
   */
  // TODO GLOAS: Review usage of this post-gloas
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
      const {invalidateFromParentBlockRoot, latestValidExecHash} = execResponse;
      // TODO GLOAS: verify if getting default variant is correct here
      const defaultStatus = this.getDefaultVariant(invalidateFromParentBlockRoot);
      const invalidateFromParentIndex =
        defaultStatus !== undefined
          ? this.getNodeIndexByRootAndStatus(invalidateFromParentBlockRoot, defaultStatus)
          : undefined;
      if (invalidateFromParentIndex === undefined) {
        throw Error(`Unable to find invalidateFromParentBlockRoot=${invalidateFromParentBlockRoot} in forkChoice`);
      }
      const latestValidHashIndex =
        latestValidExecHash !== null ? this.getNodeIndexFromLVH(latestValidExecHash, invalidateFromParentIndex) : null;
      if (latestValidHashIndex === null) {
        /**
         * The LVH (latest valid hash) is null or not found.
         *
         * The spec gives an allowance for the EL being able to return a nullish LVH if it could not
         * "determine" one. There are two interpretations:
         *
         * - "the LVH is unknown" - simply throw and move on. We can't determine which chain to invalidate
         *   since we don't know which ancestor is valid.
         *
         * - "the LVH doesn't exist" - this means that the entire ancestor chain is invalid, and should
         *   be marked as such.
         *
         * The more robust approach is to treat nullish LVH as "the LVH is unknown" rather than
         * "the LVH doesn't exist". The alternative means that we will poison a valid chain when the
         * EL is lazy (or buggy) with its LVH response.
         */
        throw Error(`Unable to find latestValidExecHash=${latestValidExecHash} in the forkchoice`);
      }

      this.propagateInValidExecutionStatusByIndex(invalidateFromParentIndex, latestValidHashIndex, currentSlot);
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
      // If PayloadSeparated, that means the node is either PENDING or EMPTY, there could be
      // some ancestor still has syncing status.
      if (node.executionStatus === ExecutionStatus.PayloadSeparated) {
        nodeIndex = node.parent;
        continue;
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
    invalidateFromParentIndex: number,
    latestValidHashIndex: number,
    currentSlot: Slot
  ): void {
    // Pass 1: mark invalidateFromParentIndex and its parents invalid
    let invalidateIndex: number | undefined = invalidateFromParentIndex;
    while (invalidateIndex !== undefined && invalidateIndex > latestValidHashIndex) {
      const invalidNode = this.invalidateNodeByIndex(invalidateIndex);
      invalidateIndex = invalidNode.parent;
    }

    // Pass 2: mark all children of invalid nodes as invalid
    for (let nodeIndex = 0; nodeIndex < this.nodes.length; nodeIndex++) {
      const node = this.getNodeFromIndex(nodeIndex);
      const parent = node.parent !== undefined ? this.getNodeByIndex(node.parent) : undefined;
      // Only invalidate if this is post merge, and either parent is invalid or the
      // consensus has failed
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

  private getNodeIndexFromLVH(latestValidExecHash: RootHex, ancestorFromIndex: number): number | null {
    let nodeIndex: number | undefined = ancestorFromIndex;
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
    }

    if (validNode.executionStatus === ExecutionStatus.Syncing) {
      validNode.executionStatus = ExecutionStatus.Valid;
    }
    return validNode;
  }

  /**
   * Get payload status tiebreaker for fork choice comparison
   * Spec: gloas/fork-choice.md#new-get_payload_status_tiebreaker
   *
   * For PENDING nodes: always returns 0
   * For EMPTY/FULL variants from slot n-1: implements tiebreaker logic based on should_extend_payload
   * For older blocks: returns node.payloadStatus
   *
   * Note: pre-gloas logic won't reach here. Pre-Gloas blocks have different roots, so they are always resolved by the weight and root tiebreaker before reaching here.
   */
  private getPayloadStatusTiebreaker(node: ProtoNode, currentSlot: Slot, proposerBoostRoot: RootHex | null): number {
    // PENDING nodes always return PENDING (no tiebreaker needed)
    // PENDING=0, EMPTY=1, FULL=2
    if (node.payloadStatus === PayloadStatus.PENDING) {
      return node.payloadStatus;
    }

    // For Gloas: check if from previous slot
    if (node.slot + 1 !== currentSlot) {
      return node.payloadStatus;
    }

    // For previous slot blocks in Gloas, decide between FULL and EMPTY
    // based on should_extend_payload
    if (node.payloadStatus === PayloadStatus.EMPTY) {
      return PayloadStatus.EMPTY;
    }
    // FULL - check should_extend_payload
    const shouldExtend = this.shouldExtendPayload(node.blockRoot, proposerBoostRoot);
    return shouldExtend ? PayloadStatus.FULL : PayloadStatus.PENDING;
  }

  /**
   * Follows the best-descendant links to find the best-block (i.e., head-block).
   *
   * Returns the ProtoNode representing the head.
   * For pre-Gloas forks, only FULL variants exist (payload embedded).
   * For Gloas, may return PENDING/EMPTY/FULL variants.
   */
  findHead(justifiedRoot: RootHex, currentSlot: Slot): ProtoNode {
    if (this.lvhError) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_LVH_EXECUTION_RESPONSE,
        ...this.lvhError,
      });
    }

    // Get canonical node: FULL for pre-Gloas, PENDING for Gloas
    const defaultStatus = this.getDefaultVariant(justifiedRoot);
    const justifiedIndex =
      defaultStatus !== undefined ? this.getNodeIndexByRootAndStatus(justifiedRoot, defaultStatus) : undefined;
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

    return bestNode;
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
    const variants = this.indices.get(finalizedRoot);
    if (variants == null) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.FINALIZED_NODE_UNKNOWN,
        root: finalizedRoot,
      });
    }

    // Find the minimum index among all variants to ensure we don't prune too much
    const finalizedIndex = Array.isArray(variants)
      ? Math.min(...variants.filter((idx) => idx !== undefined))
      : variants;

    if (finalizedIndex < this.pruneThreshold) {
      // Pruning at small numbers incurs more cost than benefit
      return [];
    }

    // Collect all block roots that will be pruned
    const prunedRoots = new Set<RootHex>();
    for (let i = 0; i < finalizedIndex; i++) {
      const node = this.nodes[i];
      if (node === undefined) {
        throw new ProtoArrayError({code: ProtoArrayErrorCode.INVALID_NODE_INDEX, index: i});
      }
      prunedRoots.add(node.blockRoot);
    }

    // Remove indices for pruned blocks and PTC votes
    for (const root of prunedRoots) {
      this.indices.delete(root);
      // Prune PTC votes for this block to prevent memory leak
      // Spec: gloas/fork-choice.md (implicit - finalized blocks don't need PTC votes)
      this.ptcVotes.delete(root);
    }

    // Store nodes prior to finalization
    const removed = this.nodes.slice(0, finalizedIndex);
    // Drop all the nodes prior to finalization
    this.nodes = this.nodes.slice(finalizedIndex);

    // Adjust the indices map - subtract finalizedIndex from all node indices
    for (const [root, variantIndices] of this.indices.entries()) {
      // Pre-Gloas: single index
      if (!Array.isArray(variantIndices)) {
        if (variantIndices < finalizedIndex) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INDEX_OVERFLOW,
            value: "indices",
          });
        }
        this.indices.set(root, variantIndices - finalizedIndex);
        continue;
      }

      // Post-Gloas: array of variant indices
      const adjustedVariants = variantIndices.map((variantIndex) => {
        if (variantIndex === undefined) {
          return undefined;
        }

        if (variantIndex < finalizedIndex) {
          throw new ProtoArrayError({
            code: ProtoArrayErrorCode.INDEX_OVERFLOW,
            value: "indices",
          });
        }
        return variantIndex - finalizedIndex;
      });
      this.indices.set(root, adjustedVariants as GloasVariantIndices);
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

  maybeUpdateBestChildAndDescendant(
    parentIndex: number,
    childIndex: number,
    currentSlot: Slot,
    proposerBoostRoot: RootHex | null
  ): void {
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
    // biome-ignore lint/suspicious/noConfusingLabels: labeled block used for early exit from complex decision tree
    outer: {
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
            break outer;
          }
          if (!childLeadsToViableHead && bestChildLeadsToViableHead) {
            // the best child leads to a viable head but the child doesn't
            newChildAndDescendant = noChange;
            break outer;
          }
          // Both nodes lead to viable heads (or both don't), need to pick winner

          // Pre-fulu we pick whichever has higher weight, tie-breaker by root
          // Post-fulu we pick whichever has higher weight, then tie-breaker by root, then tie-breaker by `getPayloadStatusTiebreaker`
          // Gloas: nodes from previous slot (n-1) with EMPTY/FULL variant have weight hardcoded to 0.
          // https://github.com/ethereum/consensus-specs/blob/69a2582d5d62c914b24894bdb65f4bd5d4e49ae4/specs/gloas/fork-choice.md?plain=1#L442
          const childEffectiveWeight =
            !isGloasBlock(childNode) ||
            childNode.payloadStatus === PayloadStatus.PENDING ||
            childNode.slot + 1 !== currentSlot
              ? childNode.weight
              : 0;
          const bestChildEffectiveWeight =
            !isGloasBlock(bestChildNode) ||
            bestChildNode.payloadStatus === PayloadStatus.PENDING ||
            bestChildNode.slot + 1 !== currentSlot
              ? bestChildNode.weight
              : 0;

          if (childEffectiveWeight !== bestChildEffectiveWeight) {
            // Different effective weights, choose the winner by weight
            newChildAndDescendant = childEffectiveWeight >= bestChildEffectiveWeight ? changeToChild : noChange;
            break outer;
          }

          if (childNode.blockRoot !== bestChildNode.blockRoot) {
            // Different blocks, tie-breaker by root
            newChildAndDescendant = childNode.blockRoot >= bestChildNode.blockRoot ? changeToChild : noChange;
            break outer;
          }

          // Same effective weight and same root — Gloas EMPTY vs FULL from n-1, tie-breaker by payload status
          // Note: pre-Gloas, each child node of a block has a unique root, so this point should not be reached
          const childTiebreaker = this.getPayloadStatusTiebreaker(childNode, currentSlot, proposerBoostRoot);
          const bestChildTiebreaker = this.getPayloadStatusTiebreaker(bestChildNode, currentSlot, proposerBoostRoot);

          if (childTiebreaker > bestChildTiebreaker) {
            newChildAndDescendant = changeToChild;
          } else if (childTiebreaker < bestChildTiebreaker) {
            newChildAndDescendant = noChange;
          } else {
            // Equal in all aspects, noChange
            newChildAndDescendant = noChange;
          }
        }
      } else if (childLeadsToViableHead) {
        // There is no current best-child and the child is viable.
        newChildAndDescendant = changeToChild;
      } else {
        // There is no current best-child but the child is not viable.
        newChildAndDescendant = noChange;
      }
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

    // If block is from a previous epoch, filter using unrealized justification & finalization information
    // If block is from the current epoch, filter using the head state's justification & finalization information
    const isFromPrevEpoch = computeEpochAtSlot(node.slot) < currentEpoch;
    const votingSourceEpoch = isFromPrevEpoch ? node.unrealizedJustifiedEpoch : node.justifiedEpoch;

    // The voting source should be at the same height as the store's justified checkpoint or
    // not more than two epochs ago
    const correctJustified =
      this.justifiedEpoch === GENESIS_EPOCH ||
      votingSourceEpoch === this.justifiedEpoch ||
      votingSourceEpoch + 2 >= currentEpoch;

    const correctFinalized = this.finalizedEpoch === 0 || this.isFinalizedRootOrDescendant(node);
    return correctJustified && correctFinalized;
  }

  /**
   * Return `true` if `node` is equal to or a descendant of the finalized node.
   * This function helps improve performance of nodeIsViableForHead a lot by avoiding
   * the loop inside `getAncestors`.
   */
  isFinalizedRootOrDescendant(node: ProtoNode): boolean {
    // The finalized and justified checkpoints represent a list of known
    // ancestors of `node` that are likely to coincide with the store's
    // finalized checkpoint.
    if (
      (node.finalizedEpoch === this.finalizedEpoch && node.finalizedRoot === this.finalizedRoot) ||
      (node.justifiedEpoch === this.finalizedEpoch && node.justifiedRoot === this.finalizedRoot) ||
      (node.unrealizedFinalizedEpoch === this.finalizedEpoch && node.unrealizedFinalizedRoot === this.finalizedRoot) ||
      (node.unrealizedJustifiedEpoch === this.finalizedEpoch && node.unrealizedJustifiedRoot === this.finalizedRoot)
    ) {
      return true;
    }

    const finalizedSlot = computeStartSlotAtEpoch(this.finalizedEpoch);
    const ancestorNode = this.getAncestorOrNull(node.blockRoot, finalizedSlot);
    return this.finalizedEpoch === 0 || (ancestorNode !== null && this.finalizedRoot === ancestorNode.blockRoot);
  }

  /**
   * Same to getAncestor but it may return null instead of throwing error
   */
  getAncestorOrNull(blockRoot: RootHex, ancestorSlot: Slot): ProtoNode | null {
    try {
      return this.getAncestor(blockRoot, ancestorSlot);
    } catch (_) {
      return null;
    }
  }

  /**
   * Returns the node identifier of an ancestor of `blockRoot` at the given `slot`.
   * (Note: `slot` refers to the block that is *returned*, not the one that is supplied.)
   *
   * NOTE: May be expensive: potentially walks through the entire fork of head to finalized block
   *
   * ### Specification
   *
   * Modified for Gloas to return node identifier instead of just root:
   * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/fork-choice.md#modified-get_ancestor
   *
   * Pre-Gloas: Returns (root, PAYLOAD_STATUS_FULL)
   * Gloas: Returns (root, payloadStatus) based on actual node state
   */
  getAncestor(blockRoot: RootHex, ancestorSlot: Slot): ProtoNode {
    // Get any variant to check the block (use variants[0])
    const variantOrArr = this.indices.get(blockRoot);
    if (variantOrArr == null) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK,
        root: blockRoot,
      });
    }

    const blockIndex = Array.isArray(variantOrArr) ? variantOrArr[0] : variantOrArr;
    const block = this.nodes[blockIndex];

    // If block is at or before queried slot, return PENDING variant (or FULL for pre-Gloas)
    if (block.slot <= ancestorSlot) {
      // For pre-Gloas: only FULL exists at variants[0]
      // For Gloas: PENDING is at variants[0]
      return block;
    }

    // Walk backwards through beacon blocks to find ancestor
    // Start with the parent of the current block
    let currentBlock = block;
    const parentVariants = this.indices.get(currentBlock.parentRoot);
    if (parentVariants == null) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR,
        descendantRoot: blockRoot,
        ancestorSlot,
      });
    }

    let parentIndex = Array.isArray(parentVariants) ? parentVariants[0] : parentVariants;
    let parentBlock = this.nodes[parentIndex];

    // Walk backwards while parent.slot > ancestorSlot
    while (parentBlock.slot > ancestorSlot) {
      currentBlock = parentBlock;

      const nextParentVariants = this.indices.get(currentBlock.parentRoot);
      if (nextParentVariants == null) {
        throw new ForkChoiceError({
          code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR,
          descendantRoot: blockRoot,
          ancestorSlot,
        });
      }

      parentIndex = Array.isArray(nextParentVariants) ? nextParentVariants[0] : nextParentVariants;
      parentBlock = this.nodes[parentIndex];
    }

    // Now parentBlock.slot <= ancestorSlot
    // Return the parent with the correct payload status based on currentBlock
    if (!isGloasBlock(currentBlock)) {
      // Pre-Gloas: return FULL variant (only one that exists)
      return parentBlock;
    }

    // Gloas: determine which parent variant (EMPTY or FULL) based on parent_block_hash
    const parentPayloadStatus = this.getParentPayloadStatus(currentBlock);
    const parentVariantIndex = this.getNodeIndexByRootAndStatus(currentBlock.parentRoot, parentPayloadStatus);

    if (parentVariantIndex === undefined) {
      throw new ForkChoiceError({
        code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR,
        descendantRoot: blockRoot,
        ancestorSlot,
      });
    }

    return this.nodes[parentVariantIndex];
  }

  /**
   * Get the parent node index for traversal
   * For Gloas blocks: returns the correct EMPTY/FULL variant based on parent payload status
   * For pre-Gloas blocks: returns the simple parent index
   * Returns undefined if parent doesn't exist or can't be found
   */
  private getParentNodeIndex(node: ProtoNode): number | undefined {
    if (isGloasBlock(node)) {
      // Use getParentPayloadStatus for Gloas blocks to get correct EMPTY/FULL variant
      const parentPayloadStatus = this.getParentPayloadStatus(node);
      return this.getNodeIndexByRootAndStatus(node.parentRoot, parentPayloadStatus);
    }
    // Simple parent traversal for pre-Gloas blocks (includes fork transition)
    return node.parent;
  }

  /**
   * Iterate from a block root backwards over nodes
   * For Gloas blocks: returns EMPTY/FULL variants (not PENDING) based on parent payload status
   * For pre-Gloas blocks: returns FULL variants
   */
  *iterateAncestorNodes(blockRoot: RootHex): IterableIterator<ProtoNode> {
    // Get canonical node: FULL for pre-Gloas, PENDING for Gloas
    const defaultStatus = this.getDefaultVariant(blockRoot);
    const startIndex =
      defaultStatus !== undefined ? this.getNodeIndexByRootAndStatus(blockRoot, defaultStatus) : undefined;
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
   * Iterate from a node backwards over ancestor nodes
   * For Gloas blocks: returns EMPTY/FULL variants (not PENDING) based on parent payload status
   * For pre-Gloas blocks: returns FULL variants
   * Handles fork transition from Gloas to pre-Gloas blocks
   */
  *iterateAncestorNodesFromNode(node: ProtoNode): IterableIterator<ProtoNode> {
    while (node.parent !== undefined) {
      const parentIndex = this.getParentNodeIndex(node);
      if (parentIndex === undefined) {
        break;
      }

      node = this.nodes[parentIndex];
      yield node;
    }
  }

  /**
   * Get all nodes from a block root backwards
   * For Gloas blocks: returns EMPTY/FULL variants (not PENDING) based on parent payload status
   * For pre-Gloas blocks: returns FULL variants
   */
  getAllAncestorNodes(blockRoot: RootHex): ProtoNode[] {
    // Get canonical node: FULL for pre-Gloas, PENDING for Gloas
    const defaultStatus = this.getDefaultVariant(blockRoot);
    const startIndex =
      defaultStatus !== undefined ? this.getNodeIndexByRootAndStatus(blockRoot, defaultStatus) : undefined;
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

    // Include starting node if node is pre-gloas
    // Reason why we exclude post-gloas is because node is always default variant (PENDING)
    // which we want to exclude.
    const nodes: ProtoNode[] = [];

    if (!isGloasBlock(node)) {
      nodes.push(node);
    }

    while (node.parent !== undefined) {
      const parentIndex = this.getParentNodeIndex(node);
      if (parentIndex === undefined) {
        break;
      }

      node = this.nodes[parentIndex];
      nodes.push(node);
    }

    return nodes;
  }

  /**
   * The opposite of iterateNodes.
   * iterateNodes is to find ancestor nodes of a blockRoot.
   * this is to find non-ancestor nodes of a blockRoot.
   *
   * For Gloas blocks: returns EMPTY/FULL variants (not PENDING) based on parent payload status
   * For pre-Gloas blocks: returns FULL variants
   */
  getAllNonAncestorNodes(blockRoot: RootHex): ProtoNode[] {
    // Get canonical node: FULL for pre-Gloas, PENDING for Gloas
    const defaultStatus = this.getDefaultVariant(blockRoot);
    if (defaultStatus === undefined) {
      return [];
    }
    const startIndex = this.getNodeIndexByRootAndStatus(blockRoot, defaultStatus);
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

    // For both Gloas and pre-Gloas blocks
    const result: ProtoNode[] = [];
    let nodeIndex = startIndex;
    while (node.parent !== undefined) {
      const parentIndex = this.getParentNodeIndex(node);
      if (parentIndex === undefined) {
        break;
      }

      node = this.nodes[parentIndex];
      // Collect non-ancestor nodes between current and parent
      // Filter to exclude PENDING nodes (FULL variant pre-gloas, EMPTY or FULL variant post-gloas)
      result.push(
        ...this.getNodesBetween(nodeIndex, parentIndex).filter((n) => n.payloadStatus !== PayloadStatus.PENDING)
      );
      nodeIndex = parentIndex;
    }
    // Collect remaining nodes from nodeIndex to beginning
    result.push(...this.getNodesBetween(nodeIndex, 0).filter((n) => n.payloadStatus !== PayloadStatus.PENDING));
    return result;
  }

  /**
   * Returns both ancestor and non-ancestor nodes in a single traversal.
   * For Gloas blocks: returns EMPTY/FULL variants (not PENDING) based on parent payload status
   * For pre-Gloas blocks: returns FULL variants
   */
  getAllAncestorAndNonAncestorNodes(blockRoot: RootHex): {ancestors: ProtoNode[]; nonAncestors: ProtoNode[]} {
    // Get canonical node: FULL for pre-Gloas, PENDING for Gloas
    const defaultStatus = this.getDefaultVariant(blockRoot);
    const startIndex =
      defaultStatus !== undefined ? this.getNodeIndexByRootAndStatus(blockRoot, defaultStatus) : undefined;
    if (startIndex === undefined) {
      return {ancestors: [], nonAncestors: []};
    }

    let node = this.nodes[startIndex];
    if (node === undefined) {
      throw new ProtoArrayError({
        code: ProtoArrayErrorCode.INVALID_NODE_INDEX,
        index: startIndex,
      });
    }

    const ancestors: ProtoNode[] = [];
    const nonAncestors: ProtoNode[] = [];

    // Include starting node if it's not PENDING (i.e., pre-Gloas or EMPTY/FULL variant post-Gloas)
    if (node.payloadStatus !== PayloadStatus.PENDING) {
      ancestors.push(node);
    }

    let nodeIndex = startIndex;
    while (node.parent !== undefined) {
      const parentIndex = this.getParentNodeIndex(node);
      if (parentIndex === undefined) {
        break;
      }

      node = this.nodes[parentIndex];
      ancestors.push(node);

      // Collect non-ancestor nodes between current and parent
      // Filter to exclude PENDING nodes (include all FULL/EMPTY for both pre-Gloas and Gloas)
      nonAncestors.push(
        ...this.getNodesBetween(nodeIndex, parentIndex).filter((n) => n.payloadStatus !== PayloadStatus.PENDING)
      );
      nodeIndex = parentIndex;
    }

    // Collect remaining non-ancestor nodes from nodeIndex to beginning
    nonAncestors.push(...this.getNodesBetween(nodeIndex, 0).filter((n) => n.payloadStatus !== PayloadStatus.PENDING));

    return {ancestors, nonAncestors};
  }

  /**
   * Check if a block exists in the proto array
   * Uses default variant (PENDING for Gloas, FULL for pre-Gloas)
   */
  hasBlock(blockRoot: RootHex): boolean {
    const defaultVariant = this.getDefaultVariant(blockRoot);
    if (defaultVariant === undefined) {
      return false;
    }
    const index = this.getNodeIndexByRootAndStatus(blockRoot, defaultVariant);
    return index !== undefined;
  }

  /**
   * Return ProtoNode for blockRoot with explicit payload status
   *
   * @param blockRoot - The block root to look up
   * @param payloadStatus - The specific payload status variant (PENDING/EMPTY/FULL)
   * @returns The ProtoNode for the specified variant, or undefined if not found
   *
   * Note: Callers must explicitly specify which variant they need.
   * Use getDefaultVariant() to get the canonical variant for a block.
   */
  getNode(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoNode | undefined {
    const blockIndex = this.getNodeIndexByRootAndStatus(blockRoot, payloadStatus);
    if (blockIndex === undefined) {
      return undefined;
    }
    return this.getNodeByIndex(blockIndex);
  }

  /**
   * Return MUTABLE ProtoBlock for blockRoot with explicit payload status
   *
   * @param blockRoot - The block root to look up
   * @param payloadStatus - The specific payload status variant (PENDING/EMPTY/FULL)
   * @returns The ProtoBlock for the specified variant (spreads properties), or undefined if not found
   *
   * Note: Callers must explicitly specify which variant they need.
   * Use getDefaultVariant() to get the canonical variant for a block.
   */
  getBlock(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock | undefined {
    const node = this.getNode(blockRoot, payloadStatus);
    if (!node) {
      return undefined;
    }
    return {
      ...node,
    };
  }

  /**
   * Return NON-MUTABLE ProtoBlock for blockRoot with explicit payload status
   *
   * @param blockRoot - The block root to look up
   * @param payloadStatus - The specific payload status variant (PENDING/EMPTY/FULL)
   * @returns The ProtoBlock for the specified variant (does not spread properties)
   * @throws Error if block not found
   *
   * Note: Callers must explicitly specify which variant they need.
   * Use getDefaultVariant() to get the canonical variant for a block.
   */
  getBlockReadonly(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock {
    const node = this.getNode(blockRoot, payloadStatus);
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
    // We use the default variant (PENDING for Gloas, FULL for pre-Gloas)
    // We cannot use FULL/EMPTY variants for Gloas because they may not be canonical
    const defaultStatus = this.getDefaultVariant(ancestorRoot);
    const ancestorNode = defaultStatus !== undefined ? this.getNode(ancestorRoot, defaultStatus) : undefined;
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
