import {AbortSignal} from "@chainsafe/abort-controller";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IClock} from "../../src/util/index.js";

type RunEveryFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

export class ClockMock implements IClock {
  readonly genesisTime = 0;

  private readonly everySlot: RunEveryFn[] = [];
  private readonly everyEpoch: RunEveryFn[] = [];

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  start = (): void => {};
  runEverySlot = (fn: RunEveryFn): number => this.everySlot.push(fn);
  runEveryEpoch = (fn: RunEveryFn): number => this.everyEpoch.push(fn);
  msToSlotFraction = (): number => 0;

  async tickSlotFns(slot: Slot, signal: AbortSignal): Promise<void> {
    for (const fn of this.everySlot) await fn(slot, signal);
  }
  async tickEpochFns(epoch: Epoch, signal: AbortSignal): Promise<void> {
    for (const fn of this.everyEpoch) await fn(epoch, signal);
  }
}
