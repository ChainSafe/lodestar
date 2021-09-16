import {AbortSignal} from "@chainsafe/abort-controller";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {ITransitionStore} from "@chainsafe/lodestar-fork-choice";
import {Epoch} from "@chainsafe/lodestar-types";
import {IEth1Provider, EthJsonRpcBlockRaw} from "./interface";
import {hexToBigint, hexToDecimal, validateHexRoot} from "./provider/eth1Provider";
import {ILogger} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

type RootHexPow = string;
type PowMergeBlock = {
  number: number;
  blockhash: RootHexPow;
  parentHash: RootHexPow;
  totalDifficulty: bigint;
};

enum StatusCode {
  PRE_MERGE = "PRE_MERGE",
  SEARCHING = "SEARCHING",
  POST_MERGE = "POST_MERGE",
}

/**
 * Numbers of epochs in advance of merge fork condition to start looking for merge block
 */
const START_EPOCHS_IN_ADVANCE = 5;

const MAX_CACHE_POW_HEIGHT_DISTANCE = 1024;

const MAX_BLOCKS_PER_PAST_REQUEST = 1000;

export type Eth1MergeBlockTrackerModules = {
  transitionStore: ITransitionStore;
  config: IChainConfig;
  logger: ILogger;
  signal: AbortSignal;
  clockEpoch: Epoch;
  isMergeComplete: boolean;
};

/**
 * Follows the eth1 chain to find a (or multiple?) merge blocks that cross the threshold of total terminal difficulty
 */
export class Eth1MergeBlockTracker {
  private readonly transitionStore: ITransitionStore;
  private readonly config: IChainConfig;
  private readonly logger: ILogger;

  /**
   * List of blocks that meet the merge block conditions and are safe for block inclusion.
   * TODO: In the edge case there are multiple, what to do?
   */
  private readonly mergeBlocks: PowMergeBlock[] = [];
  private readonly blockCache = new Map<RootHexPow, PowMergeBlock>();

  private status: StatusCode = StatusCode.PRE_MERGE;
  private readonly intervals: NodeJS.Timeout[] = [];

  constructor(
    {transitionStore, config, logger, signal, clockEpoch, isMergeComplete}: Eth1MergeBlockTrackerModules,
    private readonly eth1Provider: IEth1Provider
  ) {
    this.transitionStore = transitionStore;
    this.config = config;
    this.logger = logger;

    // If merge has already happened, disable
    if (isMergeComplete) {
      this.status = StatusCode.POST_MERGE;
      return;
    }

    // If merge is still not programed, skip
    if (config.MERGE_FORK_EPOCH >= Infinity) {
      return;
    }

    const startEpoch = this.config.MERGE_FORK_EPOCH - START_EPOCHS_IN_ADVANCE;
    if (startEpoch <= clockEpoch) {
      // Start now
      this.startFinding();
    } else {
      // Set a timer to start in the future
      const intervalToStart = setInterval(() => {
        this.startFinding();
      }, (startEpoch - clockEpoch) * SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
      this.intervals.push(intervalToStart);
    }

    signal.addEventListener("abort", () => this.close(), {once: true});
  }

  /**
   * Returns the most recent POW block that satisfies the merge block condition
   */
  getMergeBlock(): PowMergeBlock | null {
    const mergeBlock = this.mergeBlocks[this.mergeBlocks.length - 1] ?? null;

    // For better debugging in case this module stops searching too early
    if (mergeBlock === null && this.status === StatusCode.POST_MERGE) {
      throw Error("Eth1MergeBlockFinder is on POST_MERGE status and found no mergeBlock");
    }

    return mergeBlock;
  }

  /**
   * Call when merge is irrevocably completed to stop polling unnecessary data from the eth1 node
   */
  mergeCompleted(): void {
    this.status = StatusCode.POST_MERGE;
    this.close();
  }

  /**
   * Get a POW block by hash checking the local cache first
   */
  async getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null> {
    // Check cache first
    const cachedBlock = this.blockCache.get(powBlockHash);
    if (cachedBlock) return cachedBlock;

    // Fetch from node
    const blockRaw = await this.eth1Provider.getBlockByHash(powBlockHash);
    if (blockRaw) {
      const block = toPowBlock(blockRaw);
      this.blockCache.set(block.blockhash, block);
      return block;
    }

    return null;
  }

  private close(): void {
    this.intervals.forEach(clearInterval);
  }

  private startFinding(): void {
    if (this.status !== StatusCode.PRE_MERGE) return;
    this.status = StatusCode.SEARCHING;

    // 1. Fetch current head chain until finding a block with total difficulty less than `transitionStore.terminalTotalDifficulty`
    this.fetchPreviousBlocks().catch((e) => {
      this.logger.error("Error fetching past POW blocks", {}, e as Error);
    });

    // 2. Subscribe to eth1 blocks and recursively fetch potential POW blocks
    const intervalPoll = setInterval(() => {
      this.pollLatestBlock().catch((e) => {
        this.logger.error("Error fetching latest POW block", {}, e as Error);
      });
    }, this.config.SECONDS_PER_ETH1_BLOCK);

    // 3. Prune roughly every epoch
    const intervalPrune = setInterval(() => {
      this.prune();
    }, 32 * this.config.SECONDS_PER_SLOT * 1000);

    // Register interval to clean them on close()
    this.intervals.push(intervalPoll, intervalPrune);
  }

  private async fetchPreviousBlocks(): Promise<void> {
    // If latest block is under TTD, stop. Subscriptions will pick future blocks
    // If latest block is over TTD, go backwards until finding a merge block
    // Note: Must ensure parent relationship

    // Fast path for pre-merge scenario
    const latestBlockRaw = await this.eth1Provider.getBlockByNumber("latest");
    if (!latestBlockRaw) {
      throw Error("getBlockByNumber('latest') returned null");
    }

    const latestBlock = toPowBlock(latestBlockRaw);
    // TTD not reached yet, stop looking at old blocks and expect the subscription to find merge block
    if (latestBlock.totalDifficulty < this.transitionStore.terminalTotalDifficulty) {
      return;
    }

    // TTD already reached, search blocks backwards
    let minFetchedBlockNumber = latestBlock.number;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const from = minFetchedBlockNumber - MAX_BLOCKS_PER_PAST_REQUEST;
      // Re-fetch same block to have the full chain of parent-child nodes
      const to = minFetchedBlockNumber;

      try {
        const blocksRaw = await this.eth1Provider.getBlocksByNumber(from, to);
        const blocks = blocksRaw.map(toPowBlock);

        // Should never happen
        if (blocks.length < 2) {
          throw Error(`getBlocksByNumber(${from}, ${to}) returned less than 2 results`);
        }

        for (let i = 0; i < blocks.length - 1; i++) {
          const childBlock = blocks[i + 1];
          const parentBlock = blocks[i];
          if (
            childBlock.totalDifficulty >= this.transitionStore.terminalTotalDifficulty &&
            parentBlock.totalDifficulty < this.transitionStore.terminalTotalDifficulty
          ) {
            // Is terminal total difficulty block
            if (childBlock.parentHash === parentBlock.blockhash) {
              // AND has verified block -> parent relationship
              this.mergeBlocks.push(childBlock);
            } else {
              // WARNING! Re-org while doing getBlocksByNumber() call. Ensure that this block is the merge block
              // and not some of its parents.
              await this.fetchPotentialMergeBlock(childBlock);
            }

            return;
          }
        }

        // On next round
        minFetchedBlockNumber = Math.min(to, ...blocks.map((block) => block.number));

        // Scanned the entire blockchain
        if (minFetchedBlockNumber <= 0) {
          return;
        }
      } catch (e) {
        this.logger.error("Error on fetchPreviousBlocks range", {from, to}, e as Error);
      }
    }
  }

  /**
   * Fetches the current latest block according the execution client.
   * If the latest block has totalDifficulty over TTD, it will backwards recursive search the merge block.
   * TODO: How to prevent doing long recursive search after the merge block has happened?
   */
  private async pollLatestBlock(): Promise<void> {
    const latestBlockRaw = await this.eth1Provider.getBlockByNumber("latest");
    if (!latestBlockRaw) {
      throw Error("getBlockByNumber('latest') returned null");
    }

    const latestBlock = toPowBlock(latestBlockRaw);
    await this.fetchPotentialMergeBlock(latestBlock);
  }

  /**
   * Potential merge block, do a backwards search with parent hashes.
   * De-duplicates code between pollLatestBlock() and fetchPreviousBlocks().
   */
  private async fetchPotentialMergeBlock(block: PowMergeBlock): Promise<void> {
    // Persist block for future searches
    this.blockCache.set(block.blockhash, block);

    while (block.totalDifficulty >= this.transitionStore.terminalTotalDifficulty) {
      const parent = await this.getPowBlock(block.blockhash);
      // Unknown parent
      if (!parent) {
        return;
      }

      if (
        block.totalDifficulty >= this.transitionStore.terminalTotalDifficulty &&
        parent.totalDifficulty < this.transitionStore.terminalTotalDifficulty
      ) {
        // Is terminal total difficulty block AND has verified block -> parent relationship
        this.mergeBlocks.push(block);
        return;
      }

      // Fetch parent's parent
      block = parent;
    }
  }

  /**
   * Prune blocks to have at max MAX_CACHE_POW_HEIGHT_DISTANCE between the highest block number in the cache
   * and the lowest block number in the cache.
   *
   * Call every once in a while, i.e. once per epoch
   */
  private prune(): void {
    // Find the heightest block number in the cache
    let maxBlockNumber = 0;
    for (const block of this.blockCache.values()) {
      if (block.number > maxBlockNumber) {
        maxBlockNumber = block.number;
      }
    }

    // Prune blocks below the max distance
    const minHeight = maxBlockNumber - MAX_CACHE_POW_HEIGHT_DISTANCE;
    for (const [key, block] of this.blockCache.entries()) {
      if (block.number < minHeight) {
        this.blockCache.delete(key);
      }
    }
  }
}

function toPowBlock(block: EthJsonRpcBlockRaw): PowMergeBlock {
  // Validate untrusted data from API
  validateHexRoot(block.hash);
  validateHexRoot(block.parentHash);

  return {
    number: hexToDecimal(block.number),
    blockhash: block.hash,
    parentHash: block.parentHash,
    totalDifficulty: hexToBigint(block.totalDifficulty),
  };
}
