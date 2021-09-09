import {AbortSignal} from "@chainsafe/abort-controller";
import {Slot} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ErrorAborted, sleep} from "@chainsafe/lodestar-utils";

type OnSlotFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

export interface IClock {
  readonly currentSlot: Slot;
  readonly genesisTime: number;
  start(signal: AbortSignal): void;
  runEverySlot(fn: OnSlotFn): void;
}

export class Clock implements IClock {
  private readonly fns: OnSlotFn[] = [];

  constructor(
    private readonly config: IChainForkConfig,
    readonly genesisTime: number,
    private readonly onError?: (e: Error) => void
  ) {}

  get currentSlot(): Slot {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  start(signal: AbortSignal): void {
    for (const fn of this.fns) {
      this.runAtMostEvery(signal, fn).catch((e: Error) => {
        if (this.onError) this.onError(e);
      });
    }
  }

  runEverySlot(fn: OnSlotFn): void {
    this.fns.push(fn);
  }

  /**
   * If a task happens to take more than one slot to run, we might skip a slot. This is unfortunate,
   * however the alternative is to *always* process every slot, which has the chance of creating a
   * theoretically unlimited backlog of tasks. It was a conscious decision to choose to drop tasks
   * on an overloaded/latent system rather than overload it even more.
   */
  private async runAtMostEvery(signal: AbortSignal, fn: OnSlotFn): Promise<void> {
    while (!signal.aborted) {
      // Run immediatelly first
      await fn(this.currentSlot, signal);

      try {
        await sleep(this.timeUntilNextSlot(), signal);
      } catch (e) {
        if (e instanceof ErrorAborted) {
          return;
        }
        throw e;
      }
    }
  }

  private timeUntilNextSlot(): number {
    const miliSecondsPerSlot = this.config.SECONDS_PER_SLOT * 1000;
    const msFromGenesis = Date.now() - this.genesisTime * 1000;
    return miliSecondsPerSlot - Math.abs(msFromGenesis % miliSecondsPerSlot);
  }
}
