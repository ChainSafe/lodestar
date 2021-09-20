import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Root, Slot, allForks} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";

/**
 * The BlockPool is a cache of blocks that are pending processing.
 *
 * Pending blocks come in two varieties:
 * - blocks with unknown parents
 * - blocks with future slots
 */
export class BlockPool {
  /**
   * Block metadata indexed by block root
   */
  private blocks = new Map<string, {parentRoot: string; slot: Slot}>();
  /**
   * Blocks indexed by parentRoot, then blockRoot
   */
  private blocksByParent = new Map<string, Set<string>>();

  constructor(private readonly config: IChainForkConfig, private readonly logger: ILogger) {}

  addByParent(signedBlock: allForks.SignedBeaconBlock): void {
    // put block in two indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.set(blockKey, {
      parentRoot: toHexString(signedBlock.message.parentRoot),
      slot: signedBlock.message.slot,
    });

    // blocks by parent
    const parentKey = this.getParentKey(signedBlock);

    let blocksWithParent = this.blocksByParent.get(parentKey);
    if (!blocksWithParent) {
      blocksWithParent = new Set();
      this.blocksByParent.set(parentKey, blocksWithParent);
    }

    blocksWithParent.add(blockKey);

    this.logger.debug("Add block to pool", {blockKey});
  }

  remove(signedBlock: allForks.SignedBeaconBlock): void {
    // remove block from three indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.delete(blockKey);

    // blocks by parent
    const parentKey = this.getParentKey(signedBlock);
    const blocksWithParent = this.blocksByParent.get(parentKey);

    if (blocksWithParent) {
      blocksWithParent.delete(blockKey);
      if (!blocksWithParent.size) {
        this.blocksByParent.delete(parentKey);
      }
    }
  }

  getMissingAncestor(blockRoot: Root): Root {
    let root = toHexString(blockRoot);

    while (this.blocks.has(root)) {
      const block = this.blocks.get(root);
      if (!block) {
        throw Error(`Unknown root ${root}`);
      }
      root = block.parentRoot;
    }

    return fromHexString(root);
  }

  getTotalPendingBlocks(): number {
    return this.blocks.size;
  }

  has(blockRoot: Root): boolean {
    return Boolean(this.blocks.get(this.getBlockKeyByRoot(blockRoot)));
  }

  getByParent(parentRoot: Root): Uint8Array[] {
    const blockRoots = Array.from(this.blocksByParent.get(toHexString(parentRoot))?.values() ?? []);
    return blockRoots.map((root) => fromHexString(root));
  }

  private getParentKey(block: allForks.SignedBeaconBlock): string {
    return toHexString(block.message.parentRoot);
  }

  private getBlockKey(block: allForks.SignedBeaconBlock): string {
    return toHexString(this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
  }

  private getBlockKeyByRoot(root: Root): string {
    return toHexString(root);
  }
}
