import {toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";

import {IBlockJob} from "../interface";

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
   * Blocks indexed by blockRoot
   */
  private blocks: Map<string, IBlockJob>;
  /**
   * Blocks indexed by parentRoot, then blockRoot
   */
  private blocksByParent: Map<string, Map<string, IBlockJob>>;
  /**
   * Blocks indexed by slot, then blockRoot
   */
  private blocksBySlot: Map<Slot, Map<string, IBlockJob>>;

  constructor({config}: {config: IBeaconConfig}) {
    this.config = config;

    this.blocks = new Map();
    this.blocksByParent = new Map();
    this.blocksBySlot = new Map();
  }

  public addByParent(job: IBlockJob): void {
    const {signedBlock} = job;
    // put block in two indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.set(blockKey, job);
    // blocks by parent
    const parentKey = this.getParentKey(signedBlock);
    let blocksWithParent = this.blocksByParent.get(parentKey);
    if (!blocksWithParent) {
      blocksWithParent = new Map();
      this.blocksByParent.set(parentKey, blocksWithParent);
    }
    blocksWithParent.set(blockKey, job);
  }

  public addBySlot(job: IBlockJob): void {
    const {signedBlock} = job;
    // put block in two indices:
    // blocks
    const blockKey = this.getBlockKey(signedBlock);
    this.blocks.set(blockKey, job);
    // blocks by slot
    const slotKey = this.getSlotKey(signedBlock);
    let blocksAtSlot = this.blocksBySlot.get(slotKey);
    if (!blocksAtSlot) {
      blocksAtSlot = new Map();
      this.blocksBySlot.set(slotKey, blocksAtSlot);
    }
    blocksAtSlot.set(blockKey, job);
  }

  public remove(job: IBlockJob): void {
    // remove block from three indices:
    // blocks
    const blockKey = this.getBlockKey(job.signedBlock);
    this.blocks.delete(blockKey);
    // blocks by slot
    const slotKey = this.getSlotKey(job.signedBlock);
    const blocksAtSlot = this.blocksBySlot.get(slotKey);
    if (blocksAtSlot) {
      blocksAtSlot.delete(blockKey);
      if (!blocksAtSlot.size) {
        this.blocksBySlot.delete(slotKey);
      }
    }
    // blocks by parent
    const parentKey = this.getParentKey(job.signedBlock);
    const blocksWithParent = this.blocksByParent.get(parentKey);
    if (blocksWithParent) {
      blocksWithParent.delete(blockKey);
      if (!blocksWithParent.size) {
        this.blocksByParent.delete(parentKey);
      }
    }
  }

  public get(blockRoot: Root): IBlockJob | undefined {
    return this.blocks.get(toHexString(blockRoot));
  }

  public has(blockRoot: Root): boolean {
    return Boolean(this.get(blockRoot));
  }

  public getByParent(parentRoot: Root): IBlockJob[] {
    return Array.from(this.blocksByParent.get(toHexString(parentRoot))?.values() ?? []);
  }

  public getMissingAncestor(blockRoot: Root): Root {
    let root = blockRoot;
    while (this.blocks.has(toHexString(root))) {
      root = this.blocks.get(toHexString(root))?.signedBlock.message.parentRoot!;
    }
    return root;
  }

  public getPendingBlocks(): IBlockJob[] {
    return Array.from(this.blocks.values() ?? []);
  }

  public getBySlot(slot: Slot): IBlockJob[] {
    return Array.from(this.blocksBySlot.get(slot)?.values() ?? []);
  }

  private getParentKey(block: SignedBeaconBlock): string {
    return toHexString(block.message.parentRoot);
  }

  private getSlotKey(block: SignedBeaconBlock): number {
    return block.message.slot;
  }

  private getBlockKey(block: SignedBeaconBlock): string {
    return toHexString(this.config.types.BeaconBlock.hashTreeRoot(block.message));
  }
}
