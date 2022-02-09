import {phase0, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconStateAllForks, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ErrorAborted, ILogger, isErrorAborted, sleep} from "@chainsafe/lodestar-utils";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IBeaconDb} from "../db";
import {Eth1DepositsCache} from "./eth1DepositsCache";
import {Eth1DataCache} from "./eth1DataCache";
import {getEth1VotesToConsider, pickEth1Vote} from "./utils/eth1Vote";
import {getDeposits} from "./utils/deposits";
import {Eth1DataAndDeposits, IEth1Provider} from "./interface";
import {Eth1Options} from "./options";
import {HttpRpcError} from "./provider/jsonRpcHttpClient";
import {parseEth1Block} from "./provider/eth1Provider";

const MAX_BLOCKS_PER_BLOCK_QUERY = 1000;
const MAX_BLOCKS_PER_LOG_QUERY = 1000;
/** Eth1 blocks happen every 14s approx, not need to update too often once synced */
const AUTO_UPDATE_PERIOD_MS = 60 * 1000;
/** Prevent infinite loops */
const MIN_UPDATE_PERIOD_MS = 1 * 1000;
/** Miliseconds to wait after getting 429 Too Many Requests */
const RATE_LIMITED_WAIT_MS = 30 * 1000;
/** Min time to wait on auto update loop on unknown error */
const MIN_WAIT_ON_ERORR_MS = 1 * 1000;

export type Eth1DepositDataTrackerModules = {
  config: IChainForkConfig;
  db: IBeaconDb;
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

  // Internal modules, state
  private depositsCache: Eth1DepositsCache;
  private eth1DataCache: Eth1DataCache;
  private lastProcessedDepositBlockNumber: number | null;

  constructor(
    opts: Eth1Options,
    {config, db, logger, signal}: Eth1DepositDataTrackerModules,
    private readonly eth1Provider: IEth1Provider
  ) {
    this.config = config;
    this.signal = signal;
    this.logger = logger;
    this.eth1Provider = eth1Provider;
    this.depositsCache = new Eth1DepositsCache(opts, config, db);
    this.eth1DataCache = new Eth1DataCache(config, db);
    this.lastProcessedDepositBlockNumber = null;

    if (opts.depositContractDeployBlock === undefined) {
      this.logger.warn("No depositContractDeployBlock provided");
    }

    this.runAutoUpdate().catch((e: Error) => {
      if (!(e instanceof ErrorAborted)) {
        this.logger.error("Error on eth1 loop", {}, e);
      }
    });
  }

  /**
   * Return eth1Data and deposits ready for block production for a given state
   */
  async getEth1DataAndDeposits(state: CachedBeaconStateAllForks): Promise<Eth1DataAndDeposits> {
    const eth1Data = await this.getEth1Data(state);
    const deposits = await this.getDeposits(state, eth1Data);
    return {eth1Data, deposits};
  }

  /**
   * Returns an eth1Data vote for a given state.
   * Requires internal caches to be updated regularly to return good results
   */
  private async getEth1Data(state: allForks.BeaconState): Promise<phase0.Eth1Data> {
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
  private async getDeposits(
    state: CachedBeaconStateAllForks,
    eth1DataVote: phase0.Eth1Data
  ): Promise<phase0.Deposit[]> {
    // No new deposits have to be included, continue
    if (eth1DataVote.depositCount === state.eth1DepositIndex) {
      return [];
    }

    // TODO: Review if this is optimal
    // Convert to view first to hash once and compare hashes
    const eth1DataVoteView = ssz.phase0.Eth1Data.createTreeBackedFromStruct(eth1DataVote);

    // Eth1 data may change due to the vote included in this block
    const newEth1Data = allForks.becomesNewEth1Data(state, eth1DataVoteView) ? eth1DataVoteView : state.eth1Data;
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
      }
    }
  }

  /**
   * Update the deposit and block cache, returning an error if either fail
   * @returns true if it has catched up to the remote follow block
   */
  private async update(): Promise<boolean> {
    const remoteHighestBlock = await this.eth1Provider.getBlockNumber();
    const remoteFollowBlock = Math.max(0, remoteHighestBlock - this.config.ETH1_FOLLOW_DISTANCE);
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
    const toBlock = Math.min(remoteFollowBlock, fromBlock + MAX_BLOCKS_PER_LOG_QUERY - 1);

    const depositEvents = await this.eth1Provider.getDepositEvents(fromBlock, toBlock);
    this.logger.verbose("Fetched deposits", {depositCount: depositEvents.length, fromBlock, toBlock});

    await this.depositsCache.add(depositEvents);
    // Store the `toBlock` since that block may not contain
    this.lastProcessedDepositBlockNumber = toBlock;

    return toBlock >= remoteFollowBlock;
  }

  /**
   * Fetch block headers from a remote eth1 node up to follow-distance block
   *
   * depositRoot and depositCount are inferred from already fetched deposits.
   * Calling get_deposit_root() and the smart contract for a non-latest block requires an
   * archive node, something most users don't have access too.
   * @returns true if it has catched up to the remote follow block
   */
  private async updateBlockCache(remoteFollowBlock: number): Promise<boolean> {
    const lastCachedBlock = await this.eth1DataCache.getHighestCachedBlockNumber();
    // lastProcessedDepositBlockNumber sets the upper bound of the possible block range to fetch in this update
    const lastProcessedDepositBlockNumber = await this.getLastProcessedDepositBlockNumber();
    // lowestEventBlockNumber set a lower bound of possible block range to fetch in this update
    const lowestEventBlockNumber = await this.depositsCache.getLowestDepositEventBlockNumber();

    // If lowestEventBlockNumber is null = no deposits have been fetch or found yet.
    // So there's not useful blocks to fetch until at least 1 deposit is found. So updateBlockCache() returns true
    // because is has caught up to all possible data to fetch which is none.
    if (lowestEventBlockNumber === null || lastProcessedDepositBlockNumber === null) {
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
      fromBlock + MAX_BLOCKS_PER_BLOCK_QUERY - 1, // Block range is inclusive
      lastProcessedDepositBlockNumber
    );

    const blocksRaw = await this.eth1Provider.getBlocksByNumber(fromBlock, toBlock);
    const blocks = blocksRaw.map(parseEth1Block);
    this.logger.verbose("Fetched eth1 blocks", {blockCount: blocks.length, fromBlock, toBlock});

    const eth1Datas = await this.depositsCache.getEth1DataForBlocks(blocks, lastProcessedDepositBlockNumber);
    await this.eth1DataCache.add(eth1Datas);

    return toBlock >= remoteFollowBlock;
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
