import {IChainConfig} from "@lodestar/config";
import {Epoch, RootHex} from "@lodestar/types";
import {ILogger, isErrorAborted, sleep} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IMetrics} from "../metrics/index.js";
import {ZERO_HASH_HEX} from "../constants/index.js";
import {TimeSeries} from "../util/timeSeries.js";
import {IEth1Provider, EthJsonRpcBlockRaw, PowMergeBlock, MergeUpdate} from "./interface.js";
import {quantityToNum, quantityToBigint, dataToRootHex} from "./provider/utils.js";

export enum StatusCode {
  NOT_SET = "NOT_SET",
  PRE_MERGE = "PRE_MERGE",
  SEARCHING = "SEARCHING",
  FOUND = "FOUND",
  POST_MERGE = "POST_MERGE",
}

export enum MergeBlockCode {
  NOT_STARTED = "NOT_STARTED",
  SEARCHING = "SEARCHING",
  FOUND = "FOUND",
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
  metrics: IMetrics | null;
};

/* maximum time to merge to display = 1 year*/
const MAX_MERGE_TIME_DISPLAY = 1 * 365 * 24 * 3600;
/* minimum search range for binary search for merge block*/
const MIN_SEARCH_RANGE = MAX_BLOCKS_PER_PAST_REQUEST;

/**
 * Follows the eth1 chain to find a (or multiple?) merge blocks that cross the threshold of total terminal difficulty
 */
export class Eth1MergeBlockTracker {
  private readonly config: IChainConfig;
  private readonly logger: ILogger;
  private readonly signal: AbortSignal;
  private readonly metrics: IMetrics | null;
  /** Whether the search is already running, sort of a mutex to avoid eth1 client flooding */
  private running = false;

  /**
   * First found mergeBlock.
   * TODO: Accept multiple, but then handle long backwards searches properly after crossing TTD
   */
  private mergeBlock: PowMergeBlock | null = null;
  private latestBlock: PowMergeBlock | null = null;
  private latestBlockTime: number | null = null;
  private lastSearchedBlock: PowMergeBlock | null = null;

  private readonly blocksByHashCache = new Map<RootHex, PowMergeBlock>();

  private status: StatusCode = StatusCode.PRE_MERGE;
  private mergeBlockStatus: MergeBlockCode = MergeBlockCode.NOT_STARTED;

  private readonly intervals: NodeJS.Timeout[] = [];

  private mergeSecondsLeft: number | null = null;
  private mergeTimeseries = new TimeSeries({maxPoints: 100});

  constructor(
    {config, logger, signal, clockEpoch, isMergeTransitionComplete, metrics}: Eth1MergeBlockTrackerModules,
    private readonly eth1Provider: IEth1Provider
  ) {
    this.config = config;
    this.logger = logger;
    this.signal = signal;
    this.metrics = metrics;

    if (metrics) {
      const terminalTotalDifficulty = `${this.config.TERMINAL_TOTAL_DIFFICULTY}`;
      metrics.eth1.eth1MergeStatus.addCollect(() => {
        // Set merge ttd, merge status and merge block status
        metrics.eth1.eth1MergeTTD.set(Number(this.config.TERMINAL_TOTAL_DIFFICULTY));
        metrics.eth1.eth1MergeStatus.set({terminalTotalDifficulty}, Object.keys(StatusCode).lastIndexOf(this.status));
        metrics.eth1.eth1MergeBlockStatus.set(Object.keys(MergeBlockCode).lastIndexOf(this.mergeBlockStatus));

        if (this.latestBlock !== null) {
          // Set latestBlock stats
          metrics.eth1.eth1LatestBlockNumber.set(this.latestBlock.number);
          metrics.eth1.eth1LatestBlockTD.set(Number(this.latestBlock.totalDifficulty));
          metrics.eth1.eth1LatestBlockTime.set(this.latestBlockTime ?? Date.now());
        }

        // Set time to merge
        if (this.mergeSecondsLeft !== null) {
          metrics.eth1.eth1TimeLeftForMerge.set(this.mergeSecondsLeft);
        }

        // Set last searched block metrics
        if (this.lastSearchedBlock !== null) {
          metrics.eth1.eth1MergeLastSearchedBlockNumber.set(this.lastSearchedBlock.number);
          metrics.eth1.eth1MergeLastSearchedBlockTD.set(Number(this.lastSearchedBlock.totalDifficulty));
        }

        // Set merge block info if found
        if (this.mergeBlock !== null) {
          const mergeBlockMeta = {
            terminalBlockHash: this.mergeBlock.blockHash,
            // Convert all number/bigints to string labels
            terminalBlockNumber: `${this.mergeBlock.number}`,
            terminalBlockTD: `${this.mergeBlock.totalDifficulty}`,
          };
          metrics.eth1.eth1MergeBlockDetails.set(mergeBlockMeta, 1);
        }
      });
    }

    // If merge has already happened
    if (isMergeTransitionComplete) {
      this.status = StatusCode.POST_MERGE;
    }

    // If merge is still not programed, skip
    if (config.BELLATRIX_FORK_EPOCH >= Infinity) {
      this.status = StatusCode.NOT_SET;
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

  getMergeUpdate(): MergeUpdate {
    if (this.status === StatusCode.NOT_SET) {
      return null;
    } else {
      const lastUpdate =
        this.latestBlock !== null && this.latestBlockTime !== null
          ? {time: this.latestBlockTime, td: this.latestBlock.totalDifficulty}
          : null;
      if (this.latestBlock === null || this.latestBlockTime === null) {
        throw Error("Internal Error, latestBlock should be present with mergeSecondsLeft");
      }
      return {
        mergeSecondsLeft: this.mergeSecondsLeft,
        lastUpdate,
      };
    }
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
      this.blocksByHashCache.set(block.blockHash, block);
      return block;
    }

    return null;
  }

  private close(): void {
    this.intervals.forEach(clearInterval);
  }

  private setTerminalPowBlock(mergeBlock: PowMergeBlock): void {
    this.logger.info("Terminal POW block found!", {
      hash: mergeBlock.blockHash,
      number: mergeBlock.number,
      totalDifficulty: mergeBlock.totalDifficulty,
    });
    this.mergeBlock = mergeBlock;
    if (this.status !== StatusCode.POST_MERGE) {
      this.status = StatusCode.FOUND;
    }
    this.mergeBlockStatus = MergeBlockCode.FOUND;
    this.close();
  }

  private async startFinding(): Promise<void> {
    if (this.mergeBlock !== null) return;

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

    if (this.status !== StatusCode.POST_MERGE) {
      this.status = StatusCode.SEARCHING;
    }
    this.mergeBlockStatus = MergeBlockCode.SEARCHING;

    //eth1MergeStatus
    this.logger.info("Starting search for terminal POW block", {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      TERMINAL_TOTAL_DIFFICULTY: this.config.TERMINAL_TOTAL_DIFFICULTY,
    });

    // 1. Subscribe to eth1 blocks and find merge block
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
    // TTD not reached yet, stop looking at old blocks and expect the subscription to find merge block
    if (
      this.lastSearchedBlock === null ||
      this.lastSearchedBlock.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY
    ) {
      return;
    }
    if (this.lastSearchedBlock.number <= 0) {
      // The genesis block itself if the merge block
      this.setTerminalPowBlock(this.lastSearchedBlock);
      return;
    }

    this.logger.debug("Searching previous blocks for terminal block", {
      number: this.lastSearchedBlock.number,
      td: this.lastSearchedBlock.totalDifficulty,
    });
    // First do a binary search but lopsided towards the lastSearchedBlock to establish
    // a new lower bound to lastSearchedBlock where lastSearchedBlock.totalDifficultty
    // is still >= TERMINAL_TOTAL_DIFFICULTY
    let searchRange = Math.floor(this.lastSearchedBlock.number * 0.1);
    while (searchRange > MIN_SEARCH_RANGE && searchRange < this.lastSearchedBlock.number) {
      const potentialUpdate = this.lastSearchedBlock.number - searchRange;
      const potentialRawBlock = await this.eth1Provider.getBlockByNumber(potentialUpdate);
      if (potentialRawBlock === null) {
        throw Error(`Could not fetch block number=${potentialUpdate}`);
      }
      const potentialBlock = toPowBlock(potentialRawBlock);
      if (potentialBlock.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY) {
        this.lastSearchedBlock = potentialBlock;
      } else {
        searchRange = Math.floor(searchRange / 2);
      }
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // TTD already reached, search blocks backwards
      if (this.lastSearchedBlock === null) {
        throw Error("Internal Error in fetchPreviousBlocks, lastSearchedBlock is null");
      }
      const minFetchedBlockNumber: number = this.lastSearchedBlock.number;

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
        // Search in reverse so lastSearchedBlock.totalDifficulty >= TTD
        for (let i = blocks.length - 2; i >= 0; i--) {
          const childBlock = blocks[i + 1];
          const parentBlock = blocks[i];
          this.lastSearchedBlock = childBlock;
          if (
            childBlock.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY &&
            parentBlock.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY
          ) {
            // Is terminal total difficulty block
            if (childBlock.parentHash === parentBlock.blockHash) {
              // AND has verified block -> parent relationship
              return this.setTerminalPowBlock(childBlock);
            } else {
              // WARNING! Re-org while doing getBlocksByNumber() call. Ensure that this block is the merge block
              // and not some of its parents.
              return await this.fetchPotentialMergeBlock(childBlock);
            }
          }
        }

        // If we are here it means blocks[0] is still > ttd
        this.lastSearchedBlock = blocks[0];
        // Scanned the entire blockchain
        if (this.lastSearchedBlock.number <= 0) {
          // Also this is the genesis block, so it needs to be set as the mergeblock
          this.setTerminalPowBlock(this.lastSearchedBlock);
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
    if (this.mergeBlock !== null) {
      // Merge block already found
      return;
    }

    const latestBlockRaw = await this.eth1Provider.getBlockByNumber("latest");
    if (!latestBlockRaw) {
      throw Error("getBlockByNumber('latest') returned null");
    }
    const latestBlock = toPowBlock(latestBlockRaw);
    this.latestBlock = latestBlock;
    this.latestBlockTime = quantityToNum(latestBlockRaw.timestamp) * 1000;

    // Set time to merge
    this.mergeTimeseries.addPoint(
      Number(this.latestBlock.totalDifficulty),
      quantityToNum(latestBlockRaw.timestamp) * 1000
    );
    if (this.latestBlock.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY) {
      this.mergeSecondsLeft = 0;
    } else if (this.mergeTimeseries.numPoints() > 5) {
      // Calculate time to merge
      const mergeDistance = Math.max(
        Number(this.config.TERMINAL_TOTAL_DIFFICULTY - this.latestBlock.totalDifficulty),
        0
      );
      // Limit the max time by a year, to also avoid division by zero in mergeSecondsLeft calc
      const tdIncreasePerSecond = Math.max(
        this.mergeTimeseries.computeLinearSpeed(),
        (mergeDistance * 1.0) / MAX_MERGE_TIME_DISPLAY
      );
      this.mergeSecondsLeft = mergeDistance / tdIncreasePerSecond;
    }

    // If there is already a search running, return
    if (this.running) return;
    this.running = true;

    try {
      if (latestBlock.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY) {
        // We are post merge, we need to restart search
        if (this.lastSearchedBlock === null) {
          this.lastSearchedBlock = latestBlock;
          await this.fetchPreviousBlocks();
        } else if (this.lastSearchedBlock.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY) {
          // It seems like the search was previously started but got abandoned because of some
          // error. Lets just start the search again from this.lastSearchedBlock
          await this.fetchPreviousBlocks();
        } else {
          // Ok, the case is lastSearchedBlock.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY
          // We might have got a potential merge block between last searched and the current
          this.lastSearchedBlock = latestBlock;
          await this.fetchPotentialMergeBlock(latestBlock);
        }
      } else {
        // No need to run search, latest is behind TTD just update lastSearchedBlock
        this.lastSearchedBlock = latestBlock;
      }
    } catch (e) {
      this.logger.error(
        "Search for merge block failed",
        {latestBlock: latestBlock.number, lastSearchedBlock: this.lastSearchedBlock?.number ?? latestBlock.number},
        e as Error
      );
    }

    this.running = false;
  }

  /**
   * Potential merge block, do a backwards search with parent hashes.
   * De-duplicates code between pollLatestBlock() and fetchPreviousBlocks().
   */
  private async fetchPotentialMergeBlock(block: PowMergeBlock): Promise<void> {
    this.logger.debug("Potential terminal POW block", {
      number: block.number,
      hash: block.blockHash,
      totalDifficulty: block.totalDifficulty,
    });
    // Persist block for future searches
    this.blocksByHashCache.set(block.blockHash, block);

    // Check if this block is already visited

    while (block.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY) {
      this.lastSearchedBlock = block;
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
      if (parent.blockHash === block.blockHash) {
        throw Error("Infinite loop: parent.blockHash === block.blockHash");
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
    blockHash: dataToRootHex(block.hash),
    parentHash: dataToRootHex(block.parentHash),
    totalDifficulty: quantityToBigint(block.totalDifficulty),
  };
}
