import {IDepositEvent} from "../interface";

/**
 * Return deposit events of blocks grouped/sorted by block number and deposit index
 * Put [] as deposit events for blocks without events
 * @param depositEvents range deposit events
 */
export function groupDepositEventsByBlock(
  rangeDepositEvents: IDepositEvent[], fromNumber: number, toNumber: number): Map<number, IDepositEvent[]> {
  rangeDepositEvents.sort((event1, event2) => event1.index - event2.index);
  const groupedEvents = new Map();
  for (let blockNumber = fromNumber; blockNumber <= toNumber; blockNumber++) {
    groupedEvents.set(blockNumber, rangeDepositEvents.filter((event) => event.blockNumber === blockNumber));
  }
  return groupedEvents;
}
