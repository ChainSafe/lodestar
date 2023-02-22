import {sleep} from "@lodestar/utils";
import {phase0} from "@lodestar/types";
import {Eth1Block, BatchDepositEvents, IEth1Provider, IEth1StreamParams} from "./interface.js";
import {groupDepositEventsByBlock} from "./utils/groupDepositEventsByBlock.js";
import {optimizeNextBlockDiffForGenesis} from "./utils/optimizeNextBlockDiffForGenesis.js";
import {parseEth1Block} from "./provider/eth1Provider.js";

/**
 * Phase 1 of genesis building.
 * Not enough validators, only stream deposits
 * @param signal Abort stream returning after a while loop cycle. Aborts internal sleep
 */
export async function* getDepositsStream(
  fromBlock: number,
  provider: IEth1Provider,
  params: IEth1StreamParams,
  signal?: AbortSignal
): AsyncGenerator<BatchDepositEvents> {
  fromBlock = Math.max(fromBlock, provider.deployBlock);

  while (true) {
    const remoteFollowBlock = await getRemoteFollowBlock(provider, params);
    const toBlock = Math.min(remoteFollowBlock, fromBlock + params.maxBlocksPerPoll);
    const logs = await provider.getDepositEvents(fromBlock, toBlock);
    for (const batchedDeposits of groupDepositEventsByBlock(logs)) {
      yield batchedDeposits;
    }

    fromBlock = toBlock;

    // If reached head, sleep for an eth1 block. Throws if signal is aborted
    await sleep(toBlock >= remoteFollowBlock ? params.SECONDS_PER_ETH1_BLOCK * 1000 : 10, signal);
  }
}

/**
 * Phase 2 of genesis building.
 * There are enough validators, stream deposits and blocks
 * @param signal Abort stream returning after a while loop cycle. Aborts internal sleep
 */
export async function* getDepositsAndBlockStreamForGenesis(
  fromBlock: number,
  provider: IEth1Provider,
  params: IEth1StreamParams,
  signal?: AbortSignal
): AsyncGenerator<[phase0.DepositEvent[], Eth1Block]> {
  fromBlock = Math.max(fromBlock, provider.deployBlock);
  fromBlock = Math.min(fromBlock, await getRemoteFollowBlock(provider, params));
  let toBlock = fromBlock; // First, fetch only the first block

  while (true) {
    const [logs, blockRaw] = await Promise.all([
      provider.getDepositEvents(fromBlock, toBlock),
      provider.getBlockByNumber(toBlock),
    ]);

    if (!blockRaw) throw Error(`No block found for number ${toBlock}`);
    const block = parseEth1Block(blockRaw);

    yield [logs, block];

    const remoteFollowBlock = await getRemoteFollowBlock(provider, params);
    const nextBlockDiff = optimizeNextBlockDiffForGenesis(block, params);
    fromBlock = toBlock;
    toBlock = Math.min(remoteFollowBlock, fromBlock + Math.min(nextBlockDiff, params.maxBlocksPerPoll));

    // If reached head, sleep for an eth1 block. Throws if signal is aborted
    await sleep(toBlock >= remoteFollowBlock ? params.SECONDS_PER_ETH1_BLOCK * 1000 : 10, signal);
  }
}

async function getRemoteFollowBlock(provider: IEth1Provider, params: IEth1StreamParams): Promise<number> {
  const remoteHighestBlock = await provider.getBlockNumber();
  return Math.max(remoteHighestBlock - params.ETH1_FOLLOW_DISTANCE, 0);
}
