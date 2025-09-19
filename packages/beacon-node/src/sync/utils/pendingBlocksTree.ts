import {RootHex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  getBlockInputSyncCacheItemRootHex,
  isPendingBlockInput,
} from "../types.js";

export function getAllDescendantBlocks(
  blockRootHex: RootHex,
  blocks: Map<RootHex, BlockInputSyncCacheItem>
): BlockInputSyncCacheItem[] {
  // Do one pass over all blocks to index by parent
  const byParent = new MapDef<RootHex, PendingBlockInput[]>(() => []);
  for (const block of blocks.values()) {
    if (isPendingBlockInput(block)) {
      byParent.getOrDefault(block.blockInput.parentRootHex).push(block);
    }
  }

  // Then, do a second pass recursively to get `blockRootHex` child blocks
  return addToDescendantBlocks(blockRootHex, byParent);
}

/** Recursive function for `getAllDescendantBlocks()` */
function addToDescendantBlocks(
  childBlockRootHex: string,
  byParent: Map<RootHex, BlockInputSyncCacheItem[]>,
  descendantBlocks: BlockInputSyncCacheItem[] = []
): BlockInputSyncCacheItem[] {
  const firstDescendantBlocks = byParent.get(childBlockRootHex);
  if (firstDescendantBlocks) {
    for (const firstDescendantBlock of firstDescendantBlocks) {
      descendantBlocks.push(firstDescendantBlock);
      addToDescendantBlocks(getBlockInputSyncCacheItemRootHex(firstDescendantBlock), byParent, descendantBlocks);
    }
  }
  return descendantBlocks;
}

export function getDescendantBlocks(
  blockRootHex: RootHex,
  blocks: Map<RootHex, BlockInputSyncCacheItem>
): BlockInputSyncCacheItem[] {
  const descendantBlocks: BlockInputSyncCacheItem[] = [];

  for (const block of blocks.values()) {
    if ((isPendingBlockInput(block) ? block.blockInput.parentRootHex : undefined) === blockRootHex) {
      descendantBlocks.push(block);
    }
  }

  return descendantBlocks;
}

export type UnknownAndAncestorBlocks = {
  unknowns: BlockInputSyncCacheItem[];
  ancestors: PendingBlockInput[];
};

/**
 * Returns two arrays.
 * The first one has the earliest blocks that are not linked to fork-choice yet, meaning they require parent blocks to be pulled.
 * The second one has the earliest blocks that are linked to fork-choice, meaning they are ready to be processed.
 *
 * Given this chain segment unknown block n => downloaded block n + 1 => downloaded block n + 2
 *   return `{incomplete: [n], ancestors: []}`
 *
 * Given this chain segment: downloaded block n => downloaded block n + 1 => downloaded block n + 2
 *   return {incomplete: [], ancestors: [n]}
 */
export function getUnknownAndAncestorBlocks(blocks: Map<RootHex, BlockInputSyncCacheItem>): UnknownAndAncestorBlocks {
  const unknowns = new Map<RootHex, BlockInputSyncCacheItem>();
  const ancestors = new Map<RootHex, PendingBlockInput>();

  for (const block of blocks.values()) {
    if (
      block.status === PendingBlockInputStatus.pending &&
      (isPendingBlockInput(block) ? !block.blockInput.hasBlockAndAllData() : true)
    ) {
      unknowns.set(getBlockInputSyncCacheItemRootHex(block), block);
    } else if (
      isPendingBlockInput(block) &&
      block.status === PendingBlockInputStatus.downloaded &&
      !blocks.has(block.blockInput.parentRootHex)
    ) {
      ancestors.set(block.blockInput.blockRootHex, block);
    }
  }

  return {
    unknowns: Array.from(unknowns.values()),
    ancestors: Array.from(ancestors.values()),
  };
}
