import {AbortSignal} from "@chainsafe/abort-controller";
import {ErrorAborted, ILogger, isErrorAborted, sleep} from "@chainsafe/lodestar-utils";
import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Epoch, Number64, Slot} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";

type RunEveryFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

export interface IClock {
  readonly genesisTime: number;
  start(signal: AbortSignal): void;
  runEverySlot(fn: (slot: Slot, signal: AbortSignal) => Promise<void>): void;
  runEveryEpoch(fn: (epoch: Epoch, signal: AbortSignal) => Promise<void>): void;
  msToSlotFraction(slot: Slot, fraction: number): number;
}

export enum TimeItem {
  Slot,
  Epoch,
}

export class Clock implements IClock {
  readonly genesisTime: number;
  private readonly config: IChainForkConfig;
  private readonly logger: ILogger;
  private readonly fns: {timeItem: TimeItem; fn: RunEveryFn}[] = [];

  constructor(config: IChainForkConfig, logger: ILogger, opts: {genesisTime: number}) {
    this.genesisTime = opts.genesisTime;
    this.config = config;
    this.logger = logger;
  }

  start(signal: AbortSignal): void {
    for (const {timeItem, fn} of this.fns) {
      this.runAtMostEvery(timeItem, signal, fn).catch((e: Error) => {
        if (!isErrorAborted(e)) {
          this.logger.error("runAtMostEvery", {}, e);
        }
      });
    }
  }

  runEverySlot(fn: RunEveryFn): void {
    this.fns.push({timeItem: TimeItem.Slot, fn});
  }

  runEveryEpoch(fn: RunEveryFn): void {
    this.fns.push({timeItem: TimeItem.Epoch, fn});
  }

  /** Miliseconds from now to a specific slot fraction */
  msToSlotFraction(slot: Slot, fraction: number): number {
    const timeAt = this.genesisTime + this.config.SECONDS_PER_SLOT * (slot + fraction);
    return timeAt * 1000 - Date.now();
  }

  /**
   * If a task happens to take more than one slot to run, we might skip a slot. This is unfortunate,
   * however the alternative is to *always* process every slot, which has the chance of creating a
   * theoretically unlimited backlog of tasks. It was a conscious decision to choose to drop tasks
   * on an overloaded/latent system rather than overload it even more.
   */
  private async runAtMostEvery(timeItem: TimeItem, signal: AbortSignal, fn: RunEveryFn): Promise<void> {
    // Run immediatelly first
    let slot = getCurrentSlot(this.config, this.genesisTime);
    let slotOrEpoch = timeItem === TimeItem.Slot ? slot : computeEpochAtSlot(slot);
    while (!signal.aborted) {
      // Must catch fn() to ensure `sleep()` is awaited both for resolve and reject
      await fn(slotOrEpoch, signal).catch((e: Error) => {
        if (!isErrorAborted(e)) this.logger.error("Error on runEvery fn", {}, e);
      });

      try {
        await sleep(this.timeUntilNext(timeItem), signal);
        // calling getCurrentSlot here may not be correct when we're close to the next slot
        // it's safe to call getCurrentSlotAround after we sleep
        slot = getCurrentSlotAround(this.config, this.genesisTime);
        slotOrEpoch = timeItem === TimeItem.Slot ? slot : computeEpochAtSlot(slot);
      } catch (e) {
        if (e instanceof ErrorAborted) {
          return;
        }
        throw e;
      }
    }
  }

  private timeUntilNext(timeItem: TimeItem): number {
    const miliSecondsPerSlot = this.config.SECONDS_PER_SLOT * 1000;
    const msFromGenesis = Date.now() - this.genesisTime * 1000;

    if (timeItem === TimeItem.Slot) {
      if (msFromGenesis >= 0) {
        return miliSecondsPerSlot - (msFromGenesis % miliSecondsPerSlot);
      } else {
        return Math.abs(msFromGenesis % miliSecondsPerSlot);
      }
    } else {
      const miliSecondsPerEpoch = SLOTS_PER_EPOCH * miliSecondsPerSlot;
      if (msFromGenesis >= 0) {
        return miliSecondsPerEpoch - (msFromGenesis % miliSecondsPerEpoch);
      } else {
        return Math.abs(msFromGenesis % miliSecondsPerEpoch);
      }
    }
  }
}

/**
 * Same to the spec but we use Math.round instead of Math.floor.
 */
export function getCurrentSlotAround(config: IChainForkConfig, genesisTime: Number64): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  const slotsSinceGenesis = Math.round(diffInSeconds / config.SECONDS_PER_SLOT);
  return GENESIS_SLOT + slotsSinceGenesis;
}

// function useEventStream() {
//   this.stream = this.events.getEventStream([BeaconEventType.BLOCK, BeaconEventType.HEAD, BeaconEventType.CHAIN_REORG]);
//   pipeToEmitter(this.stream, this).catch((e: Error) => {
//     this.logger.error("Error on stream pipe", {}, e);
//   });

//   // On stop
//   this.stream.stop();
//   this.stream = null;
// }
