import {ChainConfig} from "@lodestar/config";
import {RootHex} from "@lodestar/types";
import {Logger, pruneSetToMax} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {Metrics} from "../metrics/index.js";
import {ZERO_HASH_HEX} from "../constants/index.js";
import {enumToIndexMap} from "../util/enum.js";
import {IEth1Provider, EthJsonRpcBlockRaw, PowMergeBlock, PowMergeBlockTimestamp, TDProgress} from "./interface.js";
import {quantityToNum, quantityToBigint, dataToRootHex} from "./provider/utils.js";

export enum StatusCode {
  STOPPED = "STOPPED",
  SEARCHING = "SEARCHING",
  FOUND = "FOUND",
}

type Status =
  | {code: StatusCode.STOPPED}
  | {code: StatusCode.SEARCHING}
  | {code: StatusCode.FOUND; mergeBlock: PowMergeBlock};

/** For metrics, index order = declaration order of StatusCode  */
const statusCodeIdx = enumToIndexMap(StatusCode);

/**
 * Bounds `blocksByHashCache` cache, imposing a max distance between highest and lowest block numbers.
 * In case of extreme forking the cache might grow unbounded.
 */
const MAX_CACHE_POW_BLOCKS = 1024;

const MAX_TD_RENDER_VALUE = Number.MAX_SAFE_INTEGER;

export type Eth1MergeBlockTrackerModules = {
  config: ChainConfig;
  logger: Logger;
  signal: AbortSignal;
  metrics: Metrics | null;
};

// get_pow_block_at_total_difficulty

/**
 * Follows the eth1 chain to find a (or multiple?) merge blocks that cross the threshold of total terminal difficulty
 *
 * Finding the mergeBlock could be done in demand when proposing pre-merge blocks. However, that would slow block
 * production during the weeks between BELLATRIX_EPOCH and TTD.
 */
export class Eth1MergeBlockTracker {
  private readonly config: ChainConfig;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;

  private readonly blocksByHashCache = new Map<RootHex, PowMergeBlock>();
  private readonly intervals: NodeJS.Timeout[] = [];

  private status: Status;
  private latestEth1Block: PowMergeBlockTimestamp | null = null;
  private getTerminalPowBlockFromEth1Promise: Promise<PowMergeBlock | null> | null = null;
  private readonly safeTDFactor: bigint;

  constructor(
    {config, logger, signal, metrics}: Eth1MergeBlockTrackerModules,
    private readonly eth1Provider: IEth1Provider
  ) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;

    this.status = {code: StatusCode.STOPPED};

    signal.addEventListener("abort", () => this.close(), {once: true});

    this.safeTDFactor = getSafeTDFactor(this.config.TERMINAL_TOTAL_DIFFICULTY);
    const scaledTTD = this.config.TERMINAL_TOTAL_DIFFICULTY / this.safeTDFactor;

    // Only run metrics if necessary
    if (metrics) {
      // TTD can't be dynamically changed during execution, register metric once
      metrics.eth1.eth1MergeTTD.set(Number(scaledTTD as bigint));
      metrics.eth1.eth1MergeTDFactor.set(Number(this.safeTDFactor as bigint));

      metrics.eth1.eth1MergeStatus.addCollect(() => {
        // Set merge ttd, merge status and merge block status
        metrics.eth1.eth1MergeStatus.set(statusCodeIdx[this.status.code]);

        if (this.latestEth1Block !== null) {
          // Set latestBlock stats
          metrics.eth1.eth1LatestBlockNumber.set(this.latestEth1Block.number);
          metrics.eth1.eth1LatestBlockTD.set(Number(this.latestEth1Block.totalDifficulty / this.safeTDFactor));
          metrics.eth1.eth1LatestBlockTimestamp.set(this.latestEth1Block.timestamp);
        }
      });
    }
  }

  /**
   * Returns the most recent POW block that satisfies the merge block condition
   */
  async getTerminalPowBlock(): Promise<PowMergeBlock | null> {
    switch (this.status.code) {
      case StatusCode.STOPPED:
        // If not module is not polling fetch the mergeBlock explicitly
        return this.getTerminalPowBlockFromEth1();

      case StatusCode.SEARCHING:
        // Assume that polling would have found the block
        return null;

      case StatusCode.FOUND:
        return this.status.mergeBlock;
    }
  }

  getTDProgress(): TDProgress | null {
    if (this.latestEth1Block === null) {
      return this.latestEth1Block;
    }

    const tdDiff = this.config.TERMINAL_TOTAL_DIFFICULTY - this.latestEth1Block.totalDifficulty;

    if (tdDiff > BigInt(0)) {
      return {
        ttdHit: false,
        tdFactor: this.safeTDFactor,
        tdDiffScaled: Number((tdDiff / this.safeTDFactor) as bigint),
        ttd: this.config.TERMINAL_TOTAL_DIFFICULTY,
        td: this.latestEth1Block.totalDifficulty,
        timestamp: this.latestEth1Block.timestamp,
      };
    } else {
      return {
        ttdHit: true,
      };
    }
  }

  /**
   * Get a POW block by hash checking the local cache first
   */
  async getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null> {
    // Check cache first
    const cachedBlock = this.blocksByHashCache.get(powBlockHash);
    if (cachedBlock) {
      return cachedBlock;
    }

    // Fetch from node
    const blockRaw = await this.eth1Provider.getBlockByHash(powBlockHash);
    if (blockRaw) {
      const block = toPowBlock(blockRaw);
      this.cacheBlock(block);
      return block;
    }

    return null;
  }

  /**
   * Should only start polling for mergeBlock if:
   * - after BELLATRIX_FORK_EPOCH
   * - Beacon node synced
   * - head state not isMergeTransitionComplete
   */
  startPollingMergeBlock(): void {
    if (this.status.code !== StatusCode.STOPPED) {
      return;
    }

    this.status = {code: StatusCode.SEARCHING};
    this.logger.info("Starting search for terminal POW block", {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      TERMINAL_TOTAL_DIFFICULTY: this.config.TERMINAL_TOTAL_DIFFICULTY,
    });

    const interval = setInterval(() => {
      // Preemptively try to find merge block and cache it if found.
      // Future callers of getTerminalPowBlock() will re-use the cached found mergeBlock.
      this.getTerminalPowBlockFromEth1().catch((e) => {
        this.logger.error("Error on findMergeBlock", {}, e as Error);
        this.metrics?.eth1.eth1PollMergeBlockErrors.inc();
      });
    }, this.config.SECONDS_PER_ETH1_BLOCK * 1000);

    this.intervals.push(interval);
  }

  private close(): void {
    this.intervals.forEach(clearInterval);
  }

  private async getTerminalPowBlockFromEth1(): Promise<PowMergeBlock | null> {
    if (!this.getTerminalPowBlockFromEth1Promise) {
      this.getTerminalPowBlockFromEth1Promise = this.internalGetTerminalPowBlockFromEth1()
        .then((mergeBlock) => {
          // Persist found merge block here to affect both caller paths:
          // - internal searcher
          // - external caller if STOPPED
          if (mergeBlock && this.status.code != StatusCode.FOUND) {
            if (this.status.code === StatusCode.SEARCHING) {
              this.close();
            }

            this.logger.info("Terminal POW block found!", {
              hash: mergeBlock.blockHash,
              number: mergeBlock.number,
              totalDifficulty: mergeBlock.totalDifficulty,
            });

            this.status = {code: StatusCode.FOUND, mergeBlock};
            this.metrics?.eth1.eth1MergeBlockDetails.set(
              {
                terminalBlockHash: mergeBlock.blockHash,
                // Convert all number/bigints to string labels
                terminalBlockNumber: mergeBlock.number.toString(10),
                terminalBlockTD: mergeBlock.totalDifficulty.toString(10),
              },
              1
            );
          }

          return mergeBlock;
        })
        .finally(() => {
          this.getTerminalPowBlockFromEth1Promise = null;
        });
    } else {
      // This should no happen, since getTerminalPowBlockFromEth1() should resolve faster than SECONDS_PER_ETH1_BLOCK.
      // else something is wrong: the el-cl comms are two slow, or the backsearch got stuck in a deep search.
      this.metrics?.eth1.getTerminalPowBlockPromiseCacheHit.inc();
    }

    return this.getTerminalPowBlockFromEth1Promise;
  }

  /**
   * **internal** + **unsafe** since it can create multiple backward searches that overload the eth1 client.
   * Must be called in a wrapper to ensure that there's only once concurrent call to this fn.
   */
  private async internalGetTerminalPowBlockFromEth1(): Promise<PowMergeBlock | null> {
    // Search merge block by hash
    // Terminal block hash override takes precedence over terminal total difficulty
    const terminalBlockHash = toHexString(this.config.TERMINAL_BLOCK_HASH);
    if (terminalBlockHash !== ZERO_HASH_HEX) {
      const block = await this.getPowBlock(terminalBlockHash);
      if (block) {
        return block;
      } else {
        // if a TERMINAL_BLOCK_HASH other than ZERO_HASH is configured and we can't find it, return NONE
        return null;
      }
    }

    // Search merge block by TTD
    else {
      const latestBlockRaw = await this.eth1Provider.getBlockByNumber("latest");
      if (!latestBlockRaw) {
        throw Error("getBlockByNumber('latest') returned null");
      }

      let block = toPowBlock(latestBlockRaw);
      this.latestEth1Block = {...block, timestamp: quantityToNum(latestBlockRaw.timestamp)};
      this.cacheBlock(block);

      // This code path to look backwards for the merge block is only necessary if:
      // - The network has not yet found the merge block
      // - There are descendants of the merge block in the eth1 chain
      // For the search below to require more than a few hops, multiple block proposers in a row must fail to detect
      // an existing merge block. Such situation is extremely unlikely, so this search is left un-optimized. Since
      // this class can start eagerly looking for the merge block when not necessary, startPollingMergeBlock() should
      // only be called when there is certainty that a mergeBlock search is necessary.

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (block.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY) {
          // TTD not reached yet
          return null;
        }

        // else block.totalDifficulty >= this.config.TERMINAL_TOTAL_DIFFICULTY
        // Potential mergeBlock! Must find the first block that passes TTD

        // Allow genesis block to reach TTD https://github.com/ethereum/consensus-specs/pull/2719
        if (block.parentHash === ZERO_HASH_HEX) {
          return block;
        }

        const parent = await this.getPowBlock(block.parentHash);
        if (!parent) {
          throw Error(`Unknown parent of block with TD>TTD ${block.parentHash}`);
        }

        this.metrics?.eth1.eth1ParentBlocksFetched.inc();

        // block.td > TTD && parent.td < TTD => block is mergeBlock
        if (parent.totalDifficulty < this.config.TERMINAL_TOTAL_DIFFICULTY) {
          // Is terminal total difficulty block AND has verified block -> parent relationship
          return block;
        } else {
          block = parent;
        }
      }
    }
  }

  private cacheBlock(block: PowMergeBlock): void {
    this.blocksByHashCache.set(block.blockHash, block);
    pruneSetToMax(this.blocksByHashCache, MAX_CACHE_POW_BLOCKS);
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

/**
 * TTD values can be very large, for xDAI > 1e45. So scale down.
 * To be good, TTD should be rendered as a number < Number.MAX_TD_RENDER_VALUE ~= 9e15
 */
export function getSafeTDFactor(ttd: bigint): bigint {
  const safeIntegerMult = ttd / BigInt(MAX_TD_RENDER_VALUE);

  // TTD < MAX_TD_RENDER_VALUE, no need to scale down
  if (safeIntegerMult === BigInt(0)) {
    return BigInt(1);
  }

  // Return closest power of 10 to ensure TD < max
  const safeIntegerMultDigits = safeIntegerMult.toString(10).length;
  return BigInt(10) ** BigInt(safeIntegerMultDigits);
}
