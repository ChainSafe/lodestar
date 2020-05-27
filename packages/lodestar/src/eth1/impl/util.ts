import {IDepositEvent} from "../interface";

/**
 * Return deposit events of blocks grouped/sorted by block number and deposit index
 * @param depositEvents range deposit events
 */
export function groupDepositEventsByBlock(rangeDepositEvents: IDepositEvent[]): Map<number, IDepositEvent[]> {
  if (!rangeDepositEvents || rangeDepositEvents.length === 0) {
    return new Map();
  }
  rangeDepositEvents.sort((event1, event2) => event1.index - event2.index);
  return rangeDepositEvents.reduce<Map<number, IDepositEvent[]>>((previousValue, currentValue) => {
    const blockNumber = currentValue.blockNumber;
    if (!previousValue.get(blockNumber)) {
      previousValue.set(blockNumber, []);
    }
    previousValue.get(blockNumber).push(currentValue);
    return previousValue;
  }, new Map());
}
