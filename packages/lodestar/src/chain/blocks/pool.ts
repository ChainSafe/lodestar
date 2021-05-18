import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, Slot, allForks} from "@chainsafe/lodestar-types";

/**
 * The BlockPool is a cache of blocks that are pending processing.
 *
 * Pending blocks come in two varieties:
 * - blocks with unknown parents
 * - blocks with future slots
 */
export class BlockPool {
  private readonly config: IBeaconConfig;
  /**
   * Block metadata indexed by block root
   */
  private blocks: Map<string, {parentRoot: string; slot: Slot}>;
  /**
   * Blocks indexed by parentRoot, then blockRoot
   */
  private blocksByParent: Map<string, Set<string>>;
  /**
   * Blocks indexed by slot, then blockRoot
   */
  private blocksBySlot: Map<Slot, Set<string>>;

  constructor({config}: {config: IBeaconConfig}) {
    this.config = config;

    this.blocks = new Map<string, {parentRoot: string; slot: Slot}>();
    this.blocksByParent = new Map<string, Set<string>>();
    this.blocksBySlot = new Map<number, Set<string>>();
  }

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
  }

  addBySlot(signedBlock: allForks.SignedBeaconBlock): void {
    // put block in two indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.set(blockKey, {
      parentRoot: toHexString(signedBlock.message.parentRoot),
      slot: signedBlock.message.slot,
    });

    // blocks by slot
    const slotKey = this.getSlotKey(signedBlock);

    let blocksAtSlot = this.blocksBySlot.get(slotKey);
    if (!blocksAtSlot) {
      blocksAtSlot = new Set();
      this.blocksBySlot.set(slotKey, blocksAtSlot);
    }

    blocksAtSlot.add(blockKey);
  }

  remove(signedBlock: allForks.SignedBeaconBlock): void {
    // remove block from three indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.delete(blockKey);

    // blocks by slot
    const slotKey = this.getSlotKey(signedBlock);
    const blocksAtSlot = this.blocksBySlot.get(slotKey);

    if (blocksAtSlot) {
      blocksAtSlot.delete(blockKey);
      if (!blocksAtSlot.size) {
        this.blocksBySlot.delete(slotKey);
      }
    }

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

  getBySlot(slot: Slot): Uint8Array[] {
    const slots = Array.from(this.blocksBySlot.keys()).filter((cachedSlot) => cachedSlot <= slot);
    const blockRoots: string[] = [];
    for (const cachedSlot of slots) {
      blockRoots.push(...Array.from(this.blocksBySlot.get(cachedSlot)?.values() ?? []));
    }
    return Array.from(new Set(blockRoots)).map((root) => fromHexString(root));
  }

  private getParentKey(block: allForks.SignedBeaconBlock): string {
    return toHexString(block.message.parentRoot);
  }

  private getSlotKey(block: allForks.SignedBeaconBlock): number {
    return block.message.slot;
  }

  private getBlockKey(block: allForks.SignedBeaconBlock): string {
    return toHexString(this.config.getTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
  }

  private getBlockKeyByRoot(root: Root): string {
    return toHexString(root);
  }
}
