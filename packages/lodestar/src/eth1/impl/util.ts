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
  return rangeDepositEvents.reduce<Map<number, IDepositEvent[]>>((groupedEvents, event) => {
    const blockNumber = event.blockNumber;
    if (!groupedEvents.get(blockNumber)) {
      groupedEvents.set(blockNumber, []);
    }
    groupedEvents.get(blockNumber).push(event);
    return groupedEvents;
  }, new Map());
}
