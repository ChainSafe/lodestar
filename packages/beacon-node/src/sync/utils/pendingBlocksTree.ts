import {RootHex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {
  DownloadedBlock,
  PendingBlock,
  PendingBlockStatus,
  UnknownAndAncestorBlocks,
  UnknownBlockInput,
  UnknownBlock,
} from "../interface.js";
import {BlockInputType} from "../../chain/blocks/types.js";

export function getAllDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  // Do one pass over all blocks to index by parent
  const byParent = new MapDef<RootHex, PendingBlock[]>(() => []);
  for (const block of blocks.values()) {
    if (block.parentBlockRootHex != null) {
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

export function getDescendantBlocks(blockRootHex: RootHex, blocks: Map<RootHex, PendingBlock>): PendingBlock[] {
  const descendantBlocks: PendingBlock[] = [];

  for (const block of blocks.values()) {
    if (block.parentBlockRootHex === blockRootHex) {
      descendantBlocks.push(block);
    }
  }

  return descendantBlocks;
}

/**
 * Given this chain segment unknown block n => downloaded block n + 1 => downloaded block n + 2
 *   return `{unknowns: [n], ancestors: []}`
 *
 * Given this chain segment: downloaded block n => downloaded block n + 1 => downloaded block n + 2
 *   return {unknowns: [], ancestors: [n]}
 */
export function getUnknownAndAncestorBlocks(blocks: Map<RootHex, PendingBlock>): UnknownAndAncestorBlocks {
  const unknowns: (UnknownBlock | UnknownBlockInput)[] = [];
  const ancestors: DownloadedBlock[] = [];

  for (const block of blocks.values()) {
    const parentHex = block.parentBlockRootHex;
    if (
      block.status === PendingBlockStatus.pending &&
      (block.blockInput == null || block.blockInput.type === BlockInputType.blobsPromise) &&
      parentHex == null
    ) {
      unknowns.push(block);
    }

    if (block.status === PendingBlockStatus.downloaded && parentHex && !blocks.has(parentHex)) {
      ancestors.push(block);
    }
  }

  return {unknowns, ancestors};
}
