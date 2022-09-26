import {phase0, ssz} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks, becomesNewEth1Data} from "@lodestar/state-transition";
import {ErrorAborted, TimeoutError, fromHex, ILogger, isErrorAborted, sleep} from "@lodestar/utils";

import {IBeaconDb} from "../db/index.js";
import {IMetrics} from "../metrics/index.js";
import {Eth1DepositsCache} from "./eth1DepositsCache.js";
import {Eth1DataCache} from "./eth1DataCache.js";
import {getEth1VotesToConsider, pickEth1Vote} from "./utils/eth1Vote.js";
import {getDeposits} from "./utils/deposits.js";
import {Eth1DataAndDeposits, IEth1Provider} from "./interface.js";
import {Eth1Options} from "./options.js";
import {HttpRpcError} from "./provider/jsonRpcHttpClient.js";
import {parseEth1Block} from "./provider/eth1Provider.js";
import {isJsonRpcTruncatedError} from "./provider/utils.js";

const MAX_BLOCKS_PER_BLOCK_QUERY = 1000;
const MIN_BLOCKS_PER_BLOCK_QUERY = 10;

const MAX_BLOCKS_PER_LOG_QUERY = 1000;
const MIN_BLOCKS_PER_LOG_QUERY = 10;

/** Eth1 blocks happen every 14s approx, not need to update too often once synced */
const AUTO_UPDATE_PERIOD_MS = 60 * 1000;
/** Prevent infinite loops */
const MIN_UPDATE_PERIOD_MS = 1 * 1000;
/** Miliseconds to wait after getting 429 Too Many Requests */
const RATE_LIMITED_WAIT_MS = 30 * 1000;
/** Min time to wait on auto update loop on unknown error */
const MIN_WAIT_ON_ERORR_MS = 1 * 1000;

/** Number of blocks to download if the node detects it is lagging behind due to an inaccurate
    relationship between block-number-based follow distance and time-based follow distance. */
const ETH1_FOLLOW_DISTANCE_DELTA_IF_SLOW = 32;

/** The absolute minimum follow distance to enforce when downloading catchup batches, from LH */
const ETH_MIN_FOLLOW_DISTANCE = 64;

export type Eth1DepositDataTrackerModules = {
  config: IChainForkConfig;
  db: IBeaconDb;
  metrics: IMetrics | null;
  logger: ILogger;
  signal: AbortSignal;
};

/**
 * Main class handling eth1 data fetching, processing and storing
 * Upon instantiation, starts fetcheing deposits and blocks at regular intervals
 */
export class Eth1DepositDataTracker {
  private config: IChainForkConfig;
  private logger: ILogger;
  private signal: AbortSignal;
  private readonly metrics: IMetrics | null;

  // Internal modules, state
  private depositsCache: Eth1DepositsCache;
  private eth1DataCache: Eth1DataCache;
  private lastProcessedDepositBlockNumber: number | null = null;

  /** Dynamically adjusted follow distance */
  private eth1FollowDistance: number;
  /** Dynamically adusted batch size to fetch deposit logs */
  private eth1GetBlocksBatchSizeDynamic = MAX_BLOCKS_PER_BLOCK_QUERY;
  /** Dynamically adusted batch size to fetch deposit logs */
  private eth1GetLogsBatchSizeDynamic = MAX_BLOCKS_PER_LOG_QUERY;
  private readonly forcedEth1DataVote: phase0.Eth1Data | null;

  constructor(
    opts: Eth1Options,
    {config, db, metrics, logger, signal}: Eth1DepositDataTrackerModules,
    private readonly eth1Provider: IEth1Provider
  ) {
    this.config = config;
    this.metrics = metrics;
    this.logger = logger;
    this.signal = signal;
    this.eth1Provider = eth1Provider;
    this.depositsCache = new Eth1DepositsCache(opts, config, db);
    this.eth1DataCache = new Eth1DataCache(config, db);
    this.eth1FollowDistance = config.ETH1_FOLLOW_DISTANCE;

    this.forcedEth1DataVote = opts.forcedEth1DataVote
      ? ssz.phase0.Eth1Data.deserialize(fromHex(opts.forcedEth1DataVote))
      : null;

    if (opts.depositContractDeployBlock === undefined) {
      this.logger.warn("No depositContractDeployBlock provided");
    }

    if (metrics) {
      // Set constant value once
      metrics?.eth1.eth1FollowDistanceSecondsConfig.set(config.SECONDS_PER_ETH1_BLOCK * config.ETH1_FOLLOW_DISTANCE);
      metrics.eth1.eth1FollowDistanceDynamic.addCollect(() => {
        metrics.eth1.eth1FollowDistanceDynamic.set(this.eth1FollowDistance);
        metrics.eth1.eth1GetBlocksBatchSizeDynamic.set(this.eth1GetBlocksBatchSizeDynamic);
        metrics.eth1.eth1GetLogsBatchSizeDynamic.set(this.eth1GetLogsBatchSizeDynamic);
      });
    }

    if (opts.enabled) {
      this.runAutoUpdate().catch((e: Error) => {
        if (!(e instanceof ErrorAborted)) {
          this.logger.error("Error on eth1 loop", {}, e);
        }
      });
    }
  }

  /**
   * Return eth1Data and deposits ready for block production for a given state
   */
  async getEth1DataAndDeposits(state: BeaconStateAllForks): Promise<Eth1DataAndDeposits> {
    const eth1Data = this.forcedEth1DataVote ?? (await this.getEth1Data(state));
    const deposits = await this.getDeposits(state, eth1Data);
    return {eth1Data, deposits};
  }

  /**
   * Returns an eth1Data vote for a given state.
   * Requires internal caches to be updated regularly to return good results
   */
  private async getEth1Data(state: BeaconStateAllForks): Promise<phase0.Eth1Data> {
    try {
      const eth1VotesToConsider = await getEth1VotesToConsider(
        this.config,
        state,
        this.eth1DataCache.get.bind(this.eth1DataCache)
      );
      return pickEth1Vote(state, eth1VotesToConsider);
    } catch (e) {
      // Note: In case there's a DB issue, don't stop a block proposal. Just vote for current eth1Data
      this.logger.error("CRITICIAL: Error reading valid votes, voting for current eth1Data", {}, e as Error);
      return state.eth1Data;
    }
  }

  /**
   * Returns deposits to be included for a given state and eth1Data vote.
   * Requires internal caches to be updated regularly to return good results
   */
  private async getDeposits(state: BeaconStateAllForks, eth1DataVote: phase0.Eth1Data): Promise<phase0.Deposit[]> {
    // No new deposits have to be included, continue
    if (eth1DataVote.depositCount === state.eth1DepositIndex) {
      return [];
    }

    // TODO: Review if this is optimal
    // Convert to view first to hash once and compare hashes
    const eth1DataVoteView = ssz.phase0.Eth1Data.toViewDU(eth1DataVote);

    // Eth1 data may change due to the vote included in this block
    const newEth1Data = becomesNewEth1Data(state, eth1DataVoteView) ? eth1DataVoteView : state.eth1Data;
    return await getDeposits(state, newEth1Data, this.depositsCache.get.bind(this.depositsCache));
  }

  /**
   * Abortable async setInterval that runs its callback once at max between `ms` at minimum
   */
  private async runAutoUpdate(): Promise<void> {
    let lastRunMs = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      lastRunMs = Date.now();

      try {
        const hasCaughtUp = await this.update();

        this.metrics?.eth1.depositTrackerIsCaughtup.set(hasCaughtUp ? 1 : 0);

        if (hasCaughtUp) {
          const sleepTimeMs = Math.max(AUTO_UPDATE_PERIOD_MS + lastRunMs - Date.now(), MIN_UPDATE_PERIOD_MS);
          await sleep(sleepTimeMs, this.signal);
        }
      } catch (e) {
        // From Infura: 429 Too Many Requests
        if (e instanceof HttpRpcError && e.status === 429) {
          this.logger.debug("Eth1 provider rate limited", {}, e);
          await sleep(RATE_LIMITED_WAIT_MS, this.signal);
        } else if (!isErrorAborted(e)) {
          this.logger.error("Error updating eth1 chain cache", {}, e as Error);
          await sleep(MIN_WAIT_ON_ERORR_MS, this.signal);
        }

        this.metrics?.eth1.depositTrackerUpdateErrors.inc(1);
      }
    }
  }

  /**
   * Update the deposit and block cache, returning an error if either fail
   * @returns true if it has catched up to the remote follow block
   */
  private async update(): Promise<boolean> {
    const remoteHighestBlock = await this.eth1Provider.getBlockNumber();
    this.metrics?.eth1.remoteHighestBlock.set(remoteHighestBlock);

    const remoteFollowBlock = remoteHighestBlock - this.eth1FollowDistance;

    // If remoteFollowBlock is not at or beyond deployBlock, there is no need to
    // fetch and track any deposit data yet
    if (remoteFollowBlock < this.eth1Provider.deployBlock ?? 0) return true;

    const hasCaughtUpDeposits = await this.updateDepositCache(remoteFollowBlock);
    const hasCaughtUpBlocks = await this.updateBlockCache(remoteFollowBlock);
    return hasCaughtUpDeposits && hasCaughtUpBlocks;
  }

  /**
   * Fetch deposit events from remote eth1 node up to follow-distance block
   * @returns true if it has catched up to the remote follow block
   */
  private async updateDepositCache(remoteFollowBlock: number): Promise<boolean> {
    const lastProcessedDepositBlockNumber = await this.getLastProcessedDepositBlockNumber();
    // The DB may contain deposits from a different chain making lastProcessedDepositBlockNumber > current chain tip
    // The Math.min() fixes those rare scenarios where fromBlock > toBlock
    const fromBlock = Math.min(remoteFollowBlock, this.getFromBlockToFetch(lastProcessedDepositBlockNumber));
    const toBlock = Math.min(remoteFollowBlock, fromBlock + this.eth1GetLogsBatchSizeDynamic - 1);

    let depositEvents;
    try {
      depositEvents = await this.eth1Provider.getDepositEvents(fromBlock, toBlock);
      // Increase the batch size linearly even if we scale down exponentioanlly (half each time)
      this.eth1GetLogsBatchSizeDynamic = Math.min(
        MAX_BLOCKS_PER_LOG_QUERY,
        this.eth1GetLogsBatchSizeDynamic + MIN_BLOCKS_PER_LOG_QUERY
      );
    } catch (e) {
      if (isJsonRpcTruncatedError(e as Error) || e instanceof TimeoutError) {
        this.eth1GetLogsBatchSizeDynamic = Math.max(
          MIN_BLOCKS_PER_LOG_QUERY,
          Math.floor(this.eth1GetLogsBatchSizeDynamic / 2)
        );
      }
      throw e;
    }

    this.logger.verbose("Fetched deposits", {depositCount: depositEvents.length, fromBlock, toBlock});
    this.metrics?.eth1.depositEventsFetched.inc(depositEvents.length);

    await this.depositsCache.add(depositEvents);
    // Store the `toBlock` since that block may not contain
    this.lastProcessedDepositBlockNumber = toBlock;
    this.metrics?.eth1.lastProcessedDepositBlockNumber.set(toBlock);

    return toBlock >= remoteFollowBlock;
  }

  /**
   * Fetch block headers from a remote eth1 node up to follow-distance block
   *
   * depositRoot and depositCount are inferred from already fetched deposits.
   * Calling get_deposit_root() and the smart contract for a non-latest block requires an
   * archive node, something most users don't have access too.
   * @returns true if it has catched up to the remote follow timestamp
   */
  private async updateBlockCache(remoteFollowBlock: number): Promise<boolean> {
    const lastCachedBlock = await this.eth1DataCache.getHighestCachedBlockNumber();
    // lastProcessedDepositBlockNumber sets the upper bound of the possible block range to fetch in this update
    const lastProcessedDepositBlockNumber = await this.getLastProcessedDepositBlockNumber();
    // lowestEventBlockNumber set a lower bound of possible block range to fetch in this update
    const lowestEventBlockNumber = await this.depositsCache.getLowestDepositEventBlockNumber();

    // We are all caught up if:
    //  1. If lowestEventBlockNumber is null = no deposits have been fetch or found yet.
    //     So there's not useful blocks to fetch until at least 1 deposit is found.
    //  2. If the remoteFollowBlock is behind the lowestEventBlockNumber. This can happen
    //     if the EL's data was wiped and restarted. Not exiting here would other wise
    //     cause a NO_DEPOSITS_FOR_BLOCK_RANGE error
    if (
      lowestEventBlockNumber === null ||
      lastProcessedDepositBlockNumber === null ||
      remoteFollowBlock < lowestEventBlockNumber
    ) {
      return true;
    }

    // Cap the upper limit of fromBlock with remoteFollowBlock in case deployBlock is set to a different network value
    const fromBlock = Math.min(
      remoteFollowBlock,
      // Fetch from the last cached block or the lowest known deposit block number
      Math.max(this.getFromBlockToFetch(lastCachedBlock), lowestEventBlockNumber)
    );
    const toBlock = Math.min(
      remoteFollowBlock,
      fromBlock + this.eth1GetBlocksBatchSizeDynamic - 1, // Block range is inclusive
      lastProcessedDepositBlockNumber
    );

    let blocksRaw;
    try {
      blocksRaw = await this.eth1Provider.getBlocksByNumber(fromBlock, toBlock);
      // Increase the batch size linearly even if we scale down exponentioanlly (half each time)
      this.eth1GetBlocksBatchSizeDynamic = Math.min(
        MAX_BLOCKS_PER_BLOCK_QUERY,
        this.eth1GetBlocksBatchSizeDynamic + MIN_BLOCKS_PER_BLOCK_QUERY
      );
    } catch (e) {
      if (isJsonRpcTruncatedError(e as Error) || e instanceof TimeoutError) {
        this.eth1GetBlocksBatchSizeDynamic = Math.max(
          MIN_BLOCKS_PER_BLOCK_QUERY,
          Math.floor(this.eth1GetBlocksBatchSizeDynamic / 2)
        );
      }
      throw e;
    }
    const blocks = blocksRaw.map(parseEth1Block);

    this.logger.verbose("Fetched eth1 blocks", {blockCount: blocks.length, fromBlock, toBlock});
    this.metrics?.eth1.blocksFetched.inc(blocks.length);
    this.metrics?.eth1.lastFetchedBlockBlockNumber.set(toBlock);
    if (blocks.length > 0) {
      this.metrics?.eth1.lastFetchedBlockTimestamp.set(blocks[blocks.length - 1].timestamp);
    }

    const eth1Datas = await this.depositsCache.getEth1DataForBlocks(blocks, lastProcessedDepositBlockNumber);
    await this.eth1DataCache.add(eth1Datas);

    // Note: ETH1_FOLLOW_DISTANCE_SECONDS = ETH1_FOLLOW_DISTANCE * SECONDS_PER_ETH1_BLOCK
    // Deposit tracker must fetch blocks and deposits up to ETH1_FOLLOW_DISTANCE_SECONDS,
    // measured in time not blocks. To vote on valid votes it must populate up to the time based follow distance.
    // If it assumes SECONDS_PER_ETH1_BLOCK but block times are:
    // - slower: Cache will not contain all blocks
    // - faster: Cache will contain all required blocks + some ahead of timed follow distance
    //
    // For mainnet we must fetch blocks up until block.timestamp < now - 28672 sec. Based on follow distance:
    // Block times | actual follow distance
    // 14          | 2048
    // 20          | 1434
    // 30          | 956
    // 60          | 478
    //
    // So if after fetching the block at ETH1_FOLLOW_DISTANCE, but it's timestamp is not greater than
    // ETH1_FOLLOW_DISTANCE_SECONDS, reduce the ETH1_FOLLOW_DISTANCE by a small delta and fetch more blocks.
    // Otherwise if the last fetched block if above ETH1_FOLLOW_DISTANCE_SECONDS, reduce ETH1_FOLLOW_DISTANCE.

    if (toBlock < remoteFollowBlock) {
      return false;
    }

    if (blocks.length === 0) {
      return true;
    }

    const remoteFollowBlockTimestamp =
      Math.round(Date.now() / 1000) - this.config.SECONDS_PER_ETH1_BLOCK * this.config.ETH1_FOLLOW_DISTANCE;
    const blockAfterTargetTimestamp = blocks.find((block) => block.timestamp >= remoteFollowBlockTimestamp);

    if (blockAfterTargetTimestamp) {
      // Catched up to target timestamp, increase eth1FollowDistance. Limit max config.ETH1_FOLLOW_DISTANCE.
      // If the block that's right above the timestamp has been fetched now, use it to compute the precise delta.
      const lastBlock = blocks[blocks.length - 1];
      const delta = Math.max(lastBlock.blockNumber - blockAfterTargetTimestamp.blockNumber, 1);
      this.eth1FollowDistance = Math.min(this.eth1FollowDistance + delta, this.config.ETH1_FOLLOW_DISTANCE);

      return true;
    } else {
      // Blocks are slower than expected, reduce eth1FollowDistance. Limit min CATCHUP_MIN_FOLLOW_DISTANCE
      const delta =
        this.eth1FollowDistance -
        Math.max(this.eth1FollowDistance - ETH1_FOLLOW_DISTANCE_DELTA_IF_SLOW, ETH_MIN_FOLLOW_DISTANCE);
      this.eth1FollowDistance = this.eth1FollowDistance - delta;

      // Even if the blocks are slow, when we are all caught up as there is no
      // further possibility to reduce follow distance, we need to call it quits
      // for now, else it leads to an incessant poll on the EL
      return delta === 0;
    }
  }

  private getFromBlockToFetch(lastCachedBlock: number | null): number {
    if (lastCachedBlock === null) {
      return this.eth1Provider.deployBlock ?? 0;
    } else {
      return lastCachedBlock + 1;
    }
  }

  private async getLastProcessedDepositBlockNumber(): Promise<number | null> {
    if (this.lastProcessedDepositBlockNumber === null) {
      this.lastProcessedDepositBlockNumber = await this.depositsCache.getHighestDepositEventBlockNumber();
    }
    return this.lastProcessedDepositBlockNumber;
  }
}
