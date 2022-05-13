import {RootHex} from "@chainsafe/lodestar-types";
import {MapDef} from "../../util/map";
import {PendingBlock, PendingBlockStatus, PendingBlockToProcess, PendingBlockToDownload} from "../interface";

export function getAllDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  // Do one pass over all blocks to index by parent
  const byParent = new MapDef<RootHex, PendingBlockToProcess[]>(() => []);
  for (const block of blocks.values()) {
    if (block.status === PendingBlockStatus.toProcess) {
      byParent.getOrDefault(block.parentBlockRootHex).push(block);
    }
  }

  // Then, do a second pass recursively to get `blockRootHex` child blocks
  return addToDescendantBlocks(blockRootHex, byParent);
}

/** Recursive function for `getAllDescendantBlocks()` */
function addToDescendantBlocks(
  childBlockRootHex: string,
  byParent: Map<RootHex, PendingBlockToProcess[]>,
  descendantBlocks: PendingBlockToProcess[] = []
): PendingBlockToProcess[] {
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
export function getDescendantBlocks(
  blockRootHex: RootHex,
  blocks: Map<RootHex, PendingBlock>
): PendingBlockToProcess[] {
  const descendantBlocks: PendingBlockToProcess[] = [];

  for (const block of blocks.values()) {
    if (block.status === PendingBlockStatus.toProcess && block.parentBlockRootHex === blockRootHex) {
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
export function getLowestPendingUnknownParents(blocks: Map<RootHex, PendingBlock>): PendingBlockToDownload[] {
  const blocksToFetch: PendingBlockToDownload[] = [];

  for (const block of blocks.values()) {
    if (block.status === PendingBlockStatus.toDownload) {
      blocksToFetch.push(block);
    }
  }

  return blocksToFetch;
}
