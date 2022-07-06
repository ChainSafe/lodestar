import {Epoch, Slot} from "@lodestar/types";
import {IClock} from "../../src/util/index.js";

type RunEveryFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

export class ClockMock implements IClock {
  readonly currentEpoch: number = 0;
  readonly genesisTime: number = 0;
  readonly secondsPerSlot: number = 12;

  private readonly everySlot: RunEveryFn[] = [];
  private readonly everyEpoch: RunEveryFn[] = [];

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  start = (): void => {};
  runEverySlot = (fn: RunEveryFn): number => this.everySlot.push(fn);
  runEveryEpoch = (fn: RunEveryFn): number => this.everyEpoch.push(fn);
  msToSlot = (_slot: number): number => 0;
  secFromSlot = (): number => 0;
  getCurrentSlot = (): number => 0;
  getCurrentEpoch = (): number => 0;

  async tickSlotFns(slot: Slot, signal: AbortSignal): Promise<void> {
    for (const fn of this.everySlot) await fn(slot, signal);
  }
  async tickEpochFns(epoch: Epoch, signal: AbortSignal): Promise<void> {
    for (const fn of this.everyEpoch) await fn(epoch, signal);
  }
}
