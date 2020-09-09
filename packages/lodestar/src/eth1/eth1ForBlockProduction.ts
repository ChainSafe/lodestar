import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Eth1Data, Deposit} from "@chainsafe/lodestar-types";
import {getNewEth1Data} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortSignal} from "abort-controller";
import {Eth1DepositsCache} from "./eth1DepositsCache";
import {Eth1BlockHeaderCache} from "./eth1BlocksCache";
import {getEth1Vote, votingPeriodStartTime} from "./utils/eth1Vote";
import {setIntervalAbortableAsync} from "../util/sleep";
import {IBeaconDb} from "../db";
import {Eth1Provider} from "./ethers";
import {fetchBlockRange} from "./httpEth1Client";
import {getCandidateBlocksFromStream} from "./utils/eth1BlockHeader";
import {IEth1ForBlockProduction} from "./interface";
import {IEth1Options} from "./options";

/**
 * Main class handling eth1 data fetching and processing
 * Has:
 * - depositsCache: stores deposit data and an updated deposit roots merkle tree
 * - blocksCache: stores eth1 blocks (hash, number, timestamp)
 *
 * Upon instantiation will fetched deposit logs and blocks up to the follow distance.
 * I will keep updating the cache at regular intervals
 */
export class Eth1ForBlockProduction implements IEth1ForBlockProduction {
  config: IBeaconConfig;
  logger: ILogger;
  opts: IEth1Options;
  signal: AbortSignal;

  // Internal modules, state
  blocksCache: Eth1BlockHeaderCache;
  depositsCache: Eth1DepositsCache;
  eth1Provider: Eth1Provider;
  lastProcessedDepositBlockNumber?: number;

  constructor({
    config,
    db,
    logger,
    opts,
    signal,
  }: {
    config: IBeaconConfig;
    db: IBeaconDb;
    logger: ILogger;
    opts: IEth1Options;
    signal: AbortSignal;
  }) {
    this.config = config;
    this.signal = signal;
    this.logger = logger;
    this.opts = opts;
    this.blocksCache = new Eth1BlockHeaderCache(config, db);
    this.depositsCache = new Eth1DepositsCache(config, db);
    this.eth1Provider = new Eth1Provider(config, opts);
    const autoUpdateIntervalMs = config.params.SECONDS_PER_ETH1_BLOCK / 2;

    setIntervalAbortableAsync(
      () =>
        this.update().catch((e) => {
          this.logger.error("Error updating eth1 chain cache", e);
        }),
      autoUpdateIntervalMs,
      signal
    ).catch((e) => {
      this.logger.error("Aborted", e);
    });
  }

  /**
   * Return eth1Data and deposits ready for blockProduction for a given state
   */
  async getEth1DataAndDeposits(
    state: TreeBacked<BeaconState>
  ): Promise<{
    eth1Data: Eth1Data;
    deposits: Deposit[];
  }> {
    const eth1Data = await this.getEth1Data(state);
    const deposits = await this.getDeposits(state, eth1Data);
    return {eth1Data, deposits};
  }

  /**
   * Returns an eth1Data vote for a given state
   * Requires `blocksCache` and `depositsCache` to be updated regularly to return good results
   */
  private async getEth1Data(state: TreeBacked<BeaconState>): Promise<Eth1Data> {
    // Fetched only the required blocks from DB with a stream
    const periodStart = votingPeriodStartTime(this.config, state);
    const eth1BlockHeaders = await getCandidateBlocksFromStream(
      this.config,
      periodStart,
      this.blocksCache.getReverseStream()
    );

    // Append partial eth1Data from deposit cache (depositCount, depositRoot)
    const eth1Data = await this.depositsCache.appendEth1DataDeposit(
      eth1BlockHeaders,
      this.lastProcessedDepositBlockNumber
    );

    return getEth1Vote(this.config, state, eth1Data);
  }

  /**
   * Returns deposits to be included for a given state and eth1Data vote
   * Requires `blocksCache` and `depositsCache` to be updated regularly to return good results
   */
  private async getDeposits(state: TreeBacked<BeaconState>, eth1DataVote: Eth1Data): Promise<Deposit[]> {
    const depositIndex = state.eth1DepositIndex;
    // Eth1 data may change due to the vote included in this block
    const {depositCount} = getNewEth1Data(this.config, state, eth1DataVote) || state.eth1Data;

    if (depositIndex > depositCount) {
      throw Error("DepositIndexTooHigh");
    } else if (depositIndex === depositCount) {
      return [];
    } else {
      const fromIndex = depositIndex;
      const toIndex = Math.min(depositCount, fromIndex + this.config.params.MAX_DEPOSITS);
      return this.depositsCache.getDeposits({fromIndex, toIndex, depositCount});
    }
  }

  /**
   * Update the deposit and block cache, returning an error if either fail.
   */
  private async update(): Promise<void> {
    const remoteHighestBlock = await this.eth1Provider.getBlockNumber();
    const remoteFollowBlock = Math.max(0, remoteHighestBlock - this.config.params.ETH1_FOLLOW_DISTANCE);
    await Promise.all([this.updateDepositCache(remoteFollowBlock), this.updateBlockCache(remoteFollowBlock)]);
  }

  /**
   * Contacts the remote eth1 node and attempts to import deposit logs up to the configured
   * follow-distance block.
   * Will process no more than `BLOCKS_PER_LOG_QUERY * MAX_LOG_REQUESTS_PER_UPDATE` blocks in a
   * single update.
   */
  private async updateDepositCache(remoteFollowBlock: number): Promise<void> {
    const lastCachedBlock =
      this.lastProcessedDepositBlockNumber || (await this.depositsCache.geHighestDepositEventBlockNumber());
    const fromBlock = this.getFromBlockToFetch(lastCachedBlock);
    const toBlock = remoteFollowBlock;

    const logs = await this.eth1Provider.getDepositEvents(fromBlock, toBlock);
    await this.depositsCache.insertLogs(logs);
    // Store the `toBlock` since that block may not contain
    this.lastProcessedDepositBlockNumber = toBlock;
  }

  /**
   * Contacts the remote eth1 node and attempts to import all blocks up to the configured
   * follow-distance block.
   * If the update was successful the cache may or may not have been modified
   *
   * depositRoot and depositCount is inferred from already fetched deposits.
   * Calling get_deposit_root() and the smart contract for a non-latest block requires an
   * archive node, something most users don't have access too.
   *
   * Fetches blocks from: currentEth1VotingPeriod, lastCachedBlock
   * Up to: highestFetchedDepositBlockNumber, remoteFollow
   */
  private async updateBlockCache(remoteFollowBlock: number): Promise<void> {
    const lastCachedBlock = await this.blocksCache.getHighestBlockNumber();
    const fromBlockNumber = this.getFromBlockToFetch(lastCachedBlock);
    const toBlock = remoteFollowBlock;

    const eth1BlockHeaders = await fetchBlockRange(this.opts.providerUrl, fromBlockNumber, toBlock, this.signal);
    await this.blocksCache.insertBlockHeaders(eth1BlockHeaders);
  }

  private getFromBlockToFetch(lastCachedBlock: number | null): number {
    return Math.max(lastCachedBlock ? lastCachedBlock + 1 : 0, this.opts.depositContractDeployBlock || 0);
  }
}
