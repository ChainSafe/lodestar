import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, phase0, Slot} from "@chainsafe/lodestar-types";

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
   * Map of root as key and parentRoot as value
   */
  private blocks: Map<string, string>;
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

    this.blocks = new Map<string, string>();
    this.blocksByParent = new Map<string, Set<string>>();
    this.blocksBySlot = new Map<number, Set<string>>();
  }

  addByParent(signedBlock: phase0.SignedBeaconBlock): void {
    // put block in two indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.set(blockKey, toHexString(signedBlock.message.parentRoot));

    // blocks by parent
    const parentKey = this.getParentKey(signedBlock);

    let blocksWithParent = this.blocksByParent.get(parentKey);
    if (!blocksWithParent) {
      blocksWithParent = new Set();
      this.blocksByParent.set(parentKey, blocksWithParent);
    }

    blocksWithParent.add(blockKey);
  }

  addBySlot(signedBlock: phase0.SignedBeaconBlock): void {
    // put block in two indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.set(blockKey, toHexString(signedBlock.message.parentRoot));

    // blocks by slot
    const slotKey = this.getSlotKey(signedBlock);

    let blocksAtSlot = this.blocksBySlot.get(slotKey);
    if (!blocksAtSlot) {
      blocksAtSlot = new Set();
      this.blocksBySlot.set(slotKey, blocksAtSlot);
    }

    blocksAtSlot.add(blockKey);
  }

  remove(signedBlock: phase0.SignedBeaconBlock): void {
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
      root = this.blocks.get(root)!;
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
    const hexArr = Array.from(this.blocksByParent.get(toHexString(parentRoot))?.values() ?? []);
    return hexArr.map((hex) => fromHexString(hex));
  }

  getBySlot(slot: Slot): Uint8Array[] {
    const slots = Array.from(this.blocksBySlot.keys()).filter((cachedSlot) => cachedSlot <= slot);
    const hexArr: string[] = [];
    for (const cachedSlot of slots) {
      hexArr.push(...Array.from(this.blocksBySlot.get(cachedSlot)?.values() ?? []));
    }
    return Array.from(new Set(hexArr)).map((hex) => fromHexString(hex));
  }

  private getParentKey(block: phase0.SignedBeaconBlock): string {
    return toHexString(block.message.parentRoot);
  }

  private getSlotKey(block: phase0.SignedBeaconBlock): number {
    return block.message.slot;
  }

  private getBlockKey(block: phase0.SignedBeaconBlock): string {
    return toHexString(this.config.types.phase0.BeaconBlock.hashTreeRoot(block.message));
  }

  private getBlockKeyByRoot(root: Root): string {
    return toHexString(root);
  }
}
