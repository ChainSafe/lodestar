import {IDepositEvent, IEth1Block} from "../interface";

/**
 * Return deposit events of blocks grouped/sorted by block number and deposit index
 * Blocks without events are omitted
 * @param depositEvents range deposit events
 */
export function groupDepositEventsByBlock(
  depositEvents: IDepositEvent[]
): {
  depositEvents: IDepositEvent[];
  blockNumber: number;
}[] {
  depositEvents.sort((event1, event2) => event1.index - event2.index);
  const depositsByBlockMap = new Map<number, IDepositEvent[]>();
  for (const deposit of depositEvents) {
    depositsByBlockMap.set(deposit.blockNumber, [...(depositsByBlockMap.get(deposit.blockNumber) || []), deposit]);
  }
  return Array.from(depositsByBlockMap.entries()).map(([blockNumber, depositEvents]) => ({
    blockNumber,
    depositEvents,
  }));
}

export function optimizeNextBlockDiffForGenesis(
  lastFetchedBlock: IEth1Block,
  params: {
    MIN_GENESIS_TIME: number;
    GENESIS_DELAY: number;
    SECONDS_PER_ETH1_BLOCK: number;
  }
): number {
  const timeToGenesis = params.MIN_GENESIS_TIME - params.GENESIS_DELAY - lastFetchedBlock.timestamp;
  const numBlocksToGenesis = Math.floor(timeToGenesis / params.SECONDS_PER_ETH1_BLOCK);
  if (numBlocksToGenesis <= 2) {
    return 1;
  } else {
    return Math.max(1, Math.floor(numBlocksToGenesis / 2));
  }
}
