import {RootHex} from "@chainsafe/lodestar-types";
import {PendingBlockType} from "..";
import {MapDef} from "../../util/map";
import {PendingBlock, PendingBlockStatus} from "../interface";

export function getAllDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  // Do one pass over all blocks to index by parent
  const byParent = new MapDef<RootHex, PendingBlock[]>(() => []);
  for (const block of blocks.values()) {
    if (block.type === PendingBlockType.UNKNOWN_PARENT) {
      byParent.getOrDefault(block.parentBlockRootHex).push(block);
    }
  }

  // Then, do a second pass recursively to get `blockRootHex` child blocks
  return addToDescendantBlocks(blockRootHex, byParent);
}

/** Recursive function for `getAllDescendantBlocks()` */
function addToDescendantBlocks(
  childBlockRootHex: string,
  byParent: Map<RootHex, PendingBlock[]>,
  descendantBlocks: PendingBlock[] = []
): PendingBlock[] {
  const firstDescendantBlocks = byParent.get(childBlockRootHex);
  if (firstDescendantBlocks) {
    for (const firstDescendantBlock of firstDescendantBlocks) {
      descendantBlocks.push(firstDescendantBlock);
      addToDescendantBlocks(firstDescendantBlock.blockRootHex, byParent, descendantBlocks);
    }
  }
  return descendantBlocks;
}

/**
 * Return UNKNOWN_PARENT pending block with the parent hex blockRootHex.
 */
export function getDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  const descendantBlocks: PendingBlock[] = [];

  for (const block of blocks.values()) {
    if (block.type === PendingBlockType.UNKNOWN_PARENT && block.parentBlockRootHex === blockRootHex) {
      descendantBlocks.push(block);
    }
  }

  return descendantBlocks;
}

/**
 * Get pending blocks that do not have a parent. This includes pending blocks:
 * + UNKNOWN_BLOCK
 * + UNKNOWN_PARENT: parent block is not known
 */
export function getLowestPendingUnknownParents(blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  const blocksToFetch: PendingBlock[] = [];

  for (const block of blocks.values()) {
    if (
      block.status === PendingBlockStatus.pending &&
      (block.type === PendingBlockType.UNKNOWN_BLOCK || !blocks.has(block.parentBlockRootHex))
    ) {
      blocksToFetch.push(block);
    }
  }

  return blocksToFetch;
}
