import {AbortSignal} from "@chainsafe/abort-controller";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {Epoch, RootHex} from "@chainsafe/lodestar-types";
import {ILogger, isErrorAborted, sleep} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {IEth1Provider, EthJsonRpcBlockRaw, PowMergeBlock} from "./interface";
import {quantityToNum, quantityToBigint, dataToRootHex} from "./provider/utils";
import {ZERO_HASH_HEX} from "../constants";

export enum StatusCode {
  PRE_MERGE = "PRE_MERGE",
  SEARCHING = "SEARCHING",
  FOUND = "FOUND",
  POST_MERGE = "POST_MERGE",
}

/** Numbers of epochs in advance of merge fork condition to start looking for merge block */
const START_EPOCHS_IN_ADVANCE = 5;

/**
 * Bounds `blocksByHashCache` cache, imposing a max distance between highest and lowest block numbers.
 * In case of extreme forking the cache might grow unbounded.
 */
const MAX_CACHE_POW_HEIGHT_DISTANCE = 1024;

/** Number of blocks to request at once in a getBlocksByNumber() request */
const MAX_BLOCKS_PER_PAST_REQUEST = 1000;

/** Prevent infinite loops on error by sleeping after each error */
const SLEEP_ON_ERROR_MS = 3000;

export type Eth1MergeBlockTrackerModules = {
  config: IChainConfig;
  logger: ILogger;
  signal: AbortSignal;
  clockEpoch: Epoch;
  isMergeTransitionComplete: boolean;
};

/**
 * Follows the eth1 chain to find a (or multiple?) merge blocks that cross the threshold of total terminal difficulty
 */
export class Eth1MergeBlockTracker {
  private readonly config: IChainConfig;
  private readonly logger: ILogger;
  private readonly signal: AbortSignal;

  /**
   * First found mergeBlock.
   * TODO: Accept multiple, but then handle long backwards searches properly after crossing TTD
   */
  private mergeBlock: PowMergeBlock | null = null;
  private readonly blocksByHashCache = new Map<RootHex, PowMergeBlock>();

  private status: StatusCode = StatusCode.PRE_MERGE;
  private readonly intervals: NodeJS.Timeout[] = [];

  constructor(
    {config, logger, signal, clockEpoch, isMergeTransitionComplete}: Eth1MergeBlockTrackerModules,
    private readonly eth1Provider: IEth1Provider
  ) {
    this.config = config;
    this.logger = logger;
    this.signal = signal;

    // If merge has already happened, disable
    if (isMergeTransitionComplete) {
      this.status = StatusCode.POST_MERGE;
      return;
    }

    // If merge is still not programed, skip
    if (config.BELLATRIX_FORK_EPOCH >= Infinity) {
      return;
    }

    const startEpoch = this.config.BELLATRIX_FORK_EPOCH - START_EPOCHS_IN_ADVANCE;
    if (startEpoch <= clockEpoch) {
      // Start now
      void this.startFinding();
    } else {
      // Set a timer to start in the future
      const intervalToStart = setInterval(() => {
        void this.startFinding();
      }, (startEpoch - clockEpoch) * SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000);
      this.intervals.push(intervalToStart);
    }

    signal.addEventListener("abort", () => this.close(), {once: true});
  }

  /**
   * Returns the most recent POW block that satisfies the merge block condition
   */
  getTerminalPowBlock(): PowMergeBlock | null {
    // For better debugging in case this module stops searching too early
    if (this.mergeBlock === null && this.status === StatusCode.POST_MERGE) {
      throw Error("Eth1MergeBlockFinder is on POST_MERGE status and found no mergeBlock");
    }

    return this.mergeBlock;
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
    const cachedBlock = this.blocksByHashCache.get(powBlockHash);
    if (cachedBlock) return cachedBlock;

    // Fetch from node
    const blockRaw = await this.eth1Provider.getBlockByHash(powBlockHash);
    if (blockRaw) {
      const block = toPowBlock(blockRaw);
      this.blocksByHashCache.set(block.blockhash, block);
      return block;
    }

    return null;
  }

  private close(): void {
    this.intervals.forEach(clearInterval);
  }

  private setTerminalPowBlock(mergeBlock: PowMergeBlock): void {
    this.logger.info("Terminal POW block found!", {
      hash: mergeBlock.blockhash,
      number: mergeBlock.number,
      totalDifficulty: mergeBlock.totalDifficulty,
    });
    this.mergeBlock = mergeBlock;
    this.status = StatusCode.FOUND;
    this.close();
  }

  private async startFinding(): Promise<void> {
    if (this.status !== StatusCode.PRE_MERGE) return;

    // Terminal block hash override takes precedence over terminal total difficulty
    const terminalBlockHash = toHexString(this.config.TERMINAL_BLOCK_HASH);
    if (terminalBlockHash !== ZERO_HASH_HEX) {
      try {
        const powBlockOverride = await this.getPowBlock(terminalBlockHash);
        if (powBlockOverride) {
          this.setTerminalPowBlock(powBlockOverride);
        }
      } catch (e) {
        if (!isErrorAborted(e)) {
          this.logger.error("Error fetching POW block from terminal block hash", {terminalBlockHash}, e as Error);
        }
      }
      // if a TERMINAL_BLOCK_HASH other than ZERO_HASH is configured and we can't find it, return NONE
      return;
    }

    this.status = StatusCode.SEARCHING;
    this.logger.info("Starting search for terminal POW block", {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      TERMINAL_TOTAL_DIFFICULTY: this.config.TERMINAL_TOTAL_DIFFICULTY,
    });

    // 1. Fetch current head chain until finding a block with total difficulty less than `transitionStore.terminalTotalDifficulty`
    this.fetchPreviousBlocks().catch((e) => {
      if (!isErrorAborted(e)) this.logger.error("Error fetching past POW blocks", {}, e);
    });

    // 2. Subscribe to eth1 blocks and recursively fetch potential POW blocks
    const intervalPoll = setInterval(() => {
      this.pollLatestBlock().catch((e) => {
        if (!isErrorAborted(e)) this.logger.error("Error fetching latest POW block", {}, e);
      });
    }, this.config.SECONDS_PER_ETH1_BLOCK * 1000);

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
    if (latestBlock.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY) {
      return;
    }

    // TTD already reached, search blocks backwards
    let minFetchedBlockNumber = latestBlock.number;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const from = Math.max(0, minFetchedBlockNumber - MAX_BLOCKS_PER_PAST_REQUEST);
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
            childBlock.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY &&
            parentBlock.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY
          ) {
            // Is terminal total difficulty block
            if (childBlock.parentHash === parentBlock.blockhash) {
              // AND has verified block -> parent relationship
              return this.setTerminalPowBlock(childBlock);
            } else {
              // WARNING! Re-org while doing getBlocksByNumber() call. Ensure that this block is the merge block
              // and not some of its parents.
              return await this.fetchPotentialMergeBlock(childBlock);
            }
          }
        }

        // On next round
        minFetchedBlockNumber = Math.min(to, ...blocks.map((block) => block.number));

        // Scanned the entire blockchain
        if (minFetchedBlockNumber <= 0) {
          return;
        }
      } catch (e) {
        if (!isErrorAborted(e)) this.logger.error("Error on fetchPreviousBlocks range", {from, to}, e as Error);
        await sleep(SLEEP_ON_ERROR_MS, this.signal);
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
    this.logger.debug("Potential terminal POW block", {
      number: block.number,
      hash: block.blockhash,
      totalDifficulty: block.totalDifficulty,
    });
    // Persist block for future searches
    this.blocksByHashCache.set(block.blockhash, block);

    // Check if this block is already visited

    while (block.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY) {
      if (block.parentHash === ZERO_HASH_HEX) {
        // Allow genesis block to reach TTD
        // https://github.com/ethereum/consensus-specs/pull/2719
        return this.setTerminalPowBlock(block);
      }

      const parent = await this.getPowBlock(block.parentHash);
      // Unknown parent
      if (!parent) {
        return;
      }

      if (
        block.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY &&
        parent.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY
      ) {
        // Is terminal total difficulty block AND has verified block -> parent relationship
        return this.setTerminalPowBlock(block);
      }

      // Guard against infinite loops
      if (parent.blockhash === block.blockhash) {
        throw Error("Infinite loop: parent.blockhash === block.blockhash");
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
    for (const block of this.blocksByHashCache.values()) {
      if (block.number > maxBlockNumber) {
        maxBlockNumber = block.number;
      }
    }

    // Prune blocks below the max distance
    const minHeight = maxBlockNumber - MAX_CACHE_POW_HEIGHT_DISTANCE;
    for (const [key, block] of this.blocksByHashCache.entries()) {
      if (block.number < minHeight) {
        this.blocksByHashCache.delete(key);
      }
    }
  }
}

export function toPowBlock(block: EthJsonRpcBlockRaw): PowMergeBlock {
  // Validate untrusted data from API
  return {
    number: quantityToNum(block.number),
    blockhash: dataToRootHex(block.hash),
    parentHash: dataToRootHex(block.parentHash),
    totalDifficulty: quantityToBigint(block.totalDifficulty),
  };
}
