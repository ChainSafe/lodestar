import {IClock} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";

type RunEveryFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

export class ClockMock implements IClock {
  currentSlot = 0;
  currentEpoch = 0;
  /** Value returned by msToSlot for any slot */
  msToSlotValue = 0;
  /** Value returned by msFromSlot for any slot */
  msFromSlotValue = 0;
  readonly genesisTime: number = 0;
  readonly secondsPerSlot: number = 12;

  private readonly everySlot: RunEveryFn[] = [];
  private readonly everyEpoch: RunEveryFn[] = [];

  start = (): void => {};
  runEverySlot = (fn: RunEveryFn): number => this.everySlot.push(fn);
  runEveryEpoch = (fn: RunEveryFn): number => this.everyEpoch.push(fn);
  msToSlot = (_slot: number): number => this.msToSlotValue;
  msFromSlot = (): number => this.msFromSlotValue;
  secFromSlot = (): number => this.msFromSlotValue / 1000;
  getCurrentSlot = (): number => this.currentSlot;
  getCurrentEpoch = (): number => this.currentEpoch;

  async tickSlotFns(slot: Slot, signal: AbortSignal): Promise<void> {
    for (const fn of this.everySlot) await fn(slot, signal);
  }
  async tickEpochFns(epoch: Epoch, signal: AbortSignal): Promise<void> {
    for (const fn of this.everyEpoch) await fn(epoch, signal);
  }
}
