import {IDepositEvent} from "../interface";

/**
 * Return deposit events of blocks.
 * @param depositEvents range deposit events
 */
export function getDepositEventsByBlock(rangeDepositEvents: IDepositEvent[]): [number, IDepositEvent[]][] {
  if (!rangeDepositEvents || rangeDepositEvents.length === 0) {
    return [];
  }
  const firstBlockNumber = rangeDepositEvents[0].blockNumber;
  const lastBlockNumber = rangeDepositEvents[rangeDepositEvents.length - 1].blockNumber;
  const result: [number, IDepositEvent[]][] = [];
  for (let blockNumber = firstBlockNumber; blockNumber <= lastBlockNumber; blockNumber ++) {
    const blockDepositEvents = rangeDepositEvents.filter(event => event.blockNumber === blockNumber);
    if (blockDepositEvents.length > 0) {
      result.push([blockNumber, blockDepositEvents]);
    }
  }
  return result;
}