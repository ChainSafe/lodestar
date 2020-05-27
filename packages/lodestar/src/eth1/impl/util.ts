import {IDepositEvent} from "../interface";

/**
 * Return deposit events of blocks sorted by block number and deposit index
 * @param depositEvents range deposit events
 */
export function groupDepositEventsByBlock(rangeDepositEvents: IDepositEvent[]): [number, IDepositEvent[]][] {
  if (!rangeDepositEvents || rangeDepositEvents.length === 0) {
    return [];
  }
  const firstBlockNumber = rangeDepositEvents[0].blockNumber;
  const lastBlockNumber = rangeDepositEvents[rangeDepositEvents.length - 1].blockNumber;
  const result: [number, IDepositEvent[]][] = [];
  for (let blockNumber = firstBlockNumber; blockNumber <= lastBlockNumber; blockNumber ++) {
    const blockDepositEvents = rangeDepositEvents.filter(event => event.blockNumber === blockNumber);
    if (blockDepositEvents.length > 0) {
      result.push([blockNumber, blockDepositEvents.sort((event1, event2) => event1.index - event2.index)]);
    }
  }
  return result;
}