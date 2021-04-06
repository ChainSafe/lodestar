import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState, fast} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {AbortSignal} from "abort-controller";
import {IBeaconDb} from "../db";
import {Eth1DepositsCache} from "./eth1DepositsCache";
import {Eth1DataCache} from "./eth1DataCache";
import {getEth1VotesToConsider, pickEth1Vote} from "./utils/eth1Vote";
import {getDeposits} from "./utils/deposits";
import {IEth1ForBlockProduction, IEth1Provider} from "./interface";
import {IEth1Options} from "./options";

/**
 * Main class handling eth1 data fetching, processing and storing
 * Upon instantiation, starts fetcheing deposits and blocks at regular intervals
 */
export class Eth1ForBlockProduction implements IEth1ForBlockProduction {
  private config: IBeaconConfig;
  private logger: ILogger;
  private signal: AbortSignal;

  // Internal modules, state
  private depositsCache: Eth1DepositsCache;
  private eth1DataCache: Eth1DataCache;
  private eth1Provider: IEth1Provider;
  private lastProcessedDepositBlockNumber: number | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private MAX_BLOCKS_PER_BLOCK_QUERY = 1000;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private MAX_BLOCKS_PER_LOG_QUERY = 1000;

  constructor({
    config,
    db,
    eth1Provider,
    logger,
    opts,
    signal,
  }: {
    config: IBeaconConfig;
    db: IBeaconDb;
    eth1Provider: IEth1Provider;
    logger: ILogger;
    opts: IEth1Options;
    signal: AbortSignal;
  }) {
    this.config = config;
    this.signal = signal;
    this.logger = logger;
    this.eth1Provider = eth1Provider;
    this.depositsCache = new Eth1DepositsCache(config, db);
    this.eth1DataCache = new Eth1DataCache(config, db);
    this.lastProcessedDepositBlockNumber = null;

    if (!opts.depositContractDeployBlock) {
      this.logger.warn("No depositContractDeployBlock provided");
    }

    const autoUpdateIntervalMs = 1000 * config.params.SECONDS_PER_ETH1_BLOCK;
    this.runAutoUpdate(autoUpdateIntervalMs).catch((e) => {
      this.logger.error("Aborted", e);
    });
  }

  /**
   * Return eth1Data and deposits ready for block production for a given state
   */
  async getEth1DataAndDeposits(
    state: CachedBeaconState<allForks.BeaconState>
  ): Promise<{
    eth1Data: phase0.Eth1Data;
    deposits: phase0.Deposit[];
  }> {
    const eth1Data = await this.getEth1Data(state);
    const deposits = await this.getDeposits(state, eth1Data);
    return {eth1Data, deposits};
  }

  /**
   * Returns an eth1Data vote for a given state.
   * Requires internal caches to be updated regularly to return good results
   */
  private async getEth1Data(state: allForks.BeaconState): Promise<phase0.Eth1Data> {
    const eth1VotesToConsider = await getEth1VotesToConsider(
      this.config,
      state,
      this.eth1DataCache.get.bind(this.eth1DataCache)
    );
    return pickEth1Vote(this.config, state, eth1VotesToConsider);
  }

  /**
   * Returns deposits to be included for a given state and eth1Data vote.
   * Requires internal caches to be updated regularly to return good results
   */
  private async getDeposits(
    state: CachedBeaconState<allForks.BeaconState>,
    eth1DataVote: phase0.Eth1Data
  ): Promise<phase0.Deposit[]> {
    // Eth1 data may change due to the vote included in this block
    const newEth1Data = fast.getNewEth1Data(state, eth1DataVote) || state.eth1Data;
    return await getDeposits(this.config, state, newEth1Data, this.depositsCache.get.bind(this.depositsCache));
  }

  /**
   * Abortable async setInterval that runs its callback once at max between `ms` at minimum
   */
  private async runAutoUpdate(intervalMs: number): Promise<void> {
    let lastRunMs = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      lastRunMs = Date.now();

      const hasCatchedUp = await this.update().catch((e) => {
        this.logger.error("Error updating eth1 chain cache", e);
      });

      if (hasCatchedUp) {
        const sleepTime = Math.max(intervalMs + lastRunMs - Date.now(), 0);
        await sleep(sleepTime, this.signal);
      }
    }
  }

  /**
   * Update the deposit and block cache, returning an error if either fail
   * @returns true if it has catched up to the remote follow block
   */
  private async update(): Promise<boolean> {
    const remoteHighestBlock = await this.eth1Provider.getBlockNumber();
    const remoteFollowBlock = Math.max(0, remoteHighestBlock - this.config.params.ETH1_FOLLOW_DISTANCE);
    const catchedUpDeposits = await this.updateDepositCache(remoteFollowBlock);
    const catchedUpBlocks = await this.updateBlockCache(remoteFollowBlock);
    return catchedUpDeposits && catchedUpBlocks;
  }

  /**
   * Fetch deposit events from remote eth1 node up to follow-distance block
   * @returns true if it has catched up to the remote follow block
   */
  private async updateDepositCache(remoteFollowBlock: number): Promise<boolean> {
    const lastProcessedDepositBlockNumber = await this.getLastProcessedDepositBlockNumber();
    const fromBlock = this.getFromBlockToFetch(lastProcessedDepositBlockNumber);
    const toBlock = Math.min(remoteFollowBlock, fromBlock + this.MAX_BLOCKS_PER_LOG_QUERY - 1);

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
    const lastProcessedDepositBlockNumber = await this.getLastProcessedDepositBlockNumber();
    const lowestEventBlockNumber = await this.depositsCache.getLowestDepositEventBlockNumber();

    // Do not fetch any blocks if no deposits have been fetched yet
    // depositCount data is available only after the first deposit event
    if (lowestEventBlockNumber === null || lastProcessedDepositBlockNumber === null) {
      return false;
    }

    const fromBlock = Math.max(this.getFromBlockToFetch(lastCachedBlock), lowestEventBlockNumber);
    const toBlock = Math.min(
      remoteFollowBlock,
      fromBlock + this.MAX_BLOCKS_PER_BLOCK_QUERY - 1, // Block range is inclusive
      lastProcessedDepositBlockNumber
    );

    const eth1Blocks = await this.eth1Provider.getBlocksByNumber(fromBlock, toBlock, this.signal);
    this.logger.verbose("Fetched eth1 blocks", {blockCount: eth1Blocks.length, fromBlock, toBlock});

    const eth1Datas = await this.depositsCache.getEth1DataForBlocks(eth1Blocks, lastProcessedDepositBlockNumber);
    await this.eth1DataCache.add(eth1Datas);

    return toBlock >= remoteFollowBlock;
  }

  private getFromBlockToFetch(lastCachedBlock: number | null): number {
    return Math.max(lastCachedBlock ? lastCachedBlock + 1 : 0, this.eth1Provider.deployBlock || 0);
  }

  private async getLastProcessedDepositBlockNumber(): Promise<number | null> {
    if (!this.lastProcessedDepositBlockNumber) {
      this.lastProcessedDepositBlockNumber = await this.depositsCache.getHighestDepositEventBlockNumber();
    }
    return this.lastProcessedDepositBlockNumber;
  }
}
