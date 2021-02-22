import {phase0} from "@chainsafe/lodestar-types";
import {IBatchDepositEvents} from "../interface";

/**
 * Return deposit events of blocks grouped/sorted by block number and deposit index
 * Blocks without events are omitted
 * @param depositEvents range deposit events
 */
export function groupDepositEventsByBlock(depositEvents: phase0.DepositEvent[]): IBatchDepositEvents[] {
  depositEvents.sort((event1, event2) => event1.index - event2.index);
  const depositsByBlockMap = new Map<number, phase0.DepositEvent[]>();
  for (const deposit of depositEvents) {
    depositsByBlockMap.set(deposit.blockNumber, [...(depositsByBlockMap.get(deposit.blockNumber) || []), deposit]);
  }
  return Array.from(depositsByBlockMap.entries()).map(([blockNumber, depositEvents]) => ({
    blockNumber,
    depositEvents,
  }));
}
