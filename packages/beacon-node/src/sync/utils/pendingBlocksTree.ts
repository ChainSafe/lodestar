import {RootHex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {PendingBlock, PendingBlockStatus} from "../interface.js";

export function getAllDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  // Do one pass over all blocks to index by parent
  const byParent = new MapDef<RootHex, PendingBlock[]>(() => []);
  for (const block of blocks.values()) {
    byParent.getOrDefault(block.parentBlockRootHex).push(block);
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

export function getDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  const descendantBlocks: PendingBlock[] = [];

  for (const block of blocks.values()) {
    if (block.parentBlockRootHex === blockRootHex) {
      descendantBlocks.push(block);
    }
  }

  return descendantBlocks;
}

export function getLowestPendingUnknownParents(blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  const blocksToFetch: PendingBlock[] = [];

  for (const block of blocks.values()) {
    if (block.status === PendingBlockStatus.pending && !blocks.has(block.parentBlockRootHex)) {
      blocksToFetch.push(block);
    }
  }

  return blocksToFetch;
}
