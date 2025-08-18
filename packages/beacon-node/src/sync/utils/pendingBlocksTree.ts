import {RootHex} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
// import {DownloadedBlock, PendingBlock, PendingBlockStatus, UnknownBlock} from "../interface.js";
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
      addToDescendantBlocks(firstDescendantBlock.blockRootHex, byParent, descendantBlocks);
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
    if (block.parentBlockRootHex === blockRootHex) {
      descendantBlocks.push(block);
    }
  }

  return descendantBlocks;
}

export type IncompleteAndAncestorBlocks = {
  incomplete: BlockInputSyncCacheItem[];
  ancestors: PendingBlockInput[];
};

/**
 * Returns two arrays, one has the items that need to be pulled still and the other is items that
 * are ready to be checked for rooting in fork-choice so the branch can be processed (or have their
 * ancestor pulled to extend the branch backward until it does root in fork-choice)
 *
 * Given this chain segment incomplete block n => downloaded block n + 1 => downloaded block n + 2
 *   return `{incomplete: [n], ancestors: []}`
 *
 * Given this chain segment: downloaded block n => downloaded block n + 1 => downloaded block n + 2
 *   return {incomplete: [], ancestors: [n]}
 */
export function getIncompleteAndAncestorBlocks(
  blocks: Map<RootHex, BlockInputSyncCacheItem>
): IncompleteAndAncestorBlocks {
  const incomplete = new Map<RootHex, BlockInputSyncCacheItem>();
  const ancestors = new Map<RootHex, BlockInputSyncCacheItem>();

  for (const block of blocks.values()) {
    // check if the block was already added via getAllDescendants
    if (incomplete.has(getBlockInputSyncCacheItemRootHex(block))) {
      continue;
    }

    // block and sidecars have bee fully downloaded and the parent is not in the pending block, attempt to find
    // parentRootHex in fork-choice to determine if its ready to be processed
    if (
      isPendingBlockInput(block) &&
      block.blockInput.hasBlockAndAllData() &&
      !blocks.has(block.blockInput.parentRootHex)
    ) {
      ancestors.set(block.blockInput.blockRootHex, block);
      const descendants = getAllDescendantBlocks(block);
      for (const descendant of descendants) {
        if (!isPendingBlockInput(descendant) || descendant.status !== PendingBlockInputStatus.downloaded) {
          incomplete.set(getBlockInputSyncCacheItemRootHex(descendant), descendant);
        }
      }
      continue;
    }

    if (block.status === PendingBlockInputStatus.pending) {
      incomplete.push(block);
    }
  }

  return {
    incomplete,
    ancestors,
  };
}
