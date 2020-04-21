import {IBlockCache, IBlock} from "../interface";

export class BlockCache<T extends IBlock> implements IBlockCache<T> {
  // sorted by ascending block height (timestamp)
  private blocks: T[];
  private distanceToHead: number;

  public init(blocks: T[], head: T): void {
    this.blocks = blocks;
    this.distanceToHead = (blocks.length > 0)? head.number - this.blocks[blocks.length - 1].number : 0;
  }

  public addBlock(block: T): void {
    // avoid duplicate
    const index = this.blocks.findIndex(item => item.number === block.number);
    if (index === -1) {
      this.blocks.push(block);
    } else {
      this.blocks.splice(index, 1, block);
    }
  }

  public hasBlock(block: T): boolean {
    return this.blocks.findIndex(item => item.number === block.number) !== -1;
  }

  /**
   * Remove blocks older than timestamp
   * @param timestamp 
   */
  public prune(timestamp: number): void {
    // index of 1st block >= timestamp
    const index = this.blocks.findIndex(item => item.timestamp >= timestamp);
    if (index === -1) {
      this.blocks = [];
      return;
    }
    // keep from index
    this.blocks.splice(0, index);
  }

  public findBlocksByTimestamp(fromTime?: number, toTime?: number): T[] {
    if (!fromTime || !toTime) {
      return this.blocks;
    }
    return this.blocks.filter(item => (item.timestamp >= fromTime && item.timestamp < toTime));
  }

  public requestNewBlock(head: T): number | undefined {
    if (!this.blocks) {
      return undefined;
    }
    // in case of reorg, we don't want to update our cache
    const lastBlock = this.blocks[this.blocks.length - 1];
    if (head.number - lastBlock.number > this.distanceToHead) {
      return lastBlock.number + 1;
    }
    return undefined;
  }
}