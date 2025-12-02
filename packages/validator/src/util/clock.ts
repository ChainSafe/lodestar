import {ChainForkConfig} from "@lodestar/config";
import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeTimeAtSlot, getCurrentSlot} from "@lodestar/state-transition";
import {Epoch, Slot, TimeSeconds} from "@lodestar/types";
import {ErrorAborted, Logger, isErrorAborted, sleep} from "@lodestar/utils";

type RunEveryFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

export type ClockOptions = {
  skipSlots?: boolean;
};

export interface IClock {
  readonly genesisTime: number;
  readonly secondsPerSlot: number;

  readonly currentEpoch: number;

  start(signal: AbortSignal): void;
  runEverySlot(fn: (slot: Slot, signal: AbortSignal) => Promise<void>): void;
  runEveryEpoch(fn: (epoch: Epoch, signal: AbortSignal) => Promise<void>): void;
  msToSlot(slot: Slot): number;
  msFromSlot(slot: Slot): number;
  secFromSlot(slot: Slot): number;
  getCurrentSlot(): Slot;
  getCurrentEpoch(): Epoch;
}

export enum TimeItem {
  Slot,
  Epoch,
}

export class Clock implements IClock {
  readonly genesisTime: number;
  readonly secondsPerSlot: number;
  private readonly config: ChainForkConfig;
  private readonly logger: Logger;
  private readonly fns: {timeItem: TimeItem; fn: RunEveryFn}[] = [];

  constructor(
    config: ChainForkConfig,
    logger: Logger,
    private readonly opts: {genesisTime: number} & ClockOptions
  ) {
    this.genesisTime = opts.genesisTime;
    this.secondsPerSlot = config.SLOT_DURATION_MS / 1000;
    this.config = config;
    this.logger = logger;
  }

  get currentEpoch(): Epoch {
    return computeEpochAtSlot(getCurrentSlot(this.config, this.genesisTime));
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

  getCurrentSlot(): Slot {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  getCurrentEpoch(): Epoch {
    return computeEpochAtSlot(getCurrentSlot(this.config, this.genesisTime));
  }

  runEverySlot(fn: RunEveryFn): void {
    this.fns.push({timeItem: TimeItem.Slot, fn});
  }

  runEveryEpoch(fn: RunEveryFn): void {
    this.fns.push({timeItem: TimeItem.Epoch, fn});
  }

  /** Milliseconds from now to a specific slot */
  msToSlot(slot: Slot): number {
    return computeTimeAtSlot(this.config, slot, this.genesisTime) * 1000 - Date.now();
  }

  /** Milliseconds elapsed from a specific slot to now */
  msFromSlot(slot: Slot): number {
    return Date.now() - computeTimeAtSlot(this.config, slot, this.genesisTime) * 1000;
  }

  /** Seconds elapsed from a specific slot to now */
  secFromSlot(slot: Slot): number {
    return Date.now() / 1000 - computeTimeAtSlot(this.config, slot, this.genesisTime);
  }

  /**
   * If a task happens to take more than one slot to run, we might skip a slot. This is unfortunate,
   * however the alternative is to *always* process every slot, which has the chance of creating a
   * theoretically unlimited backlog of tasks. It was a conscious decision to choose to drop tasks
   * on an overloaded/latent system rather than overload it even more.
   */
  private async runAtMostEvery(timeItem: TimeItem, signal: AbortSignal, fn: RunEveryFn): Promise<void> {
    // Run immediately first
    let slot = getCurrentSlot(this.config, this.genesisTime);
    let slotOrEpoch = timeItem === TimeItem.Slot ? slot : computeEpochAtSlot(slot);
    while (!signal.aborted) {
      // Must catch fn() to ensure `sleep()` is awaited both for resolve and reject
      const task = fn(slotOrEpoch, signal).catch((e: Error) => {
        if (!isErrorAborted(e)) this.logger.error("Error on runEvery fn", {}, e);
      });

      if (timeItem !== TimeItem.Slot || this.opts.skipSlots !== false) {
        // await response to only continue with next task if current task finished within slot
        await task;
      }

      try {
        await sleep(this.timeUntilNext(timeItem), signal);
        // calling getCurrentSlot here may not be correct when we're close to the next slot
        // it's safe to call getCurrentSlotAround after we sleep
        const nextSlot = getCurrentSlotAround(this.config, this.genesisTime);

        if (timeItem === TimeItem.Slot) {
          if (nextSlot > slot + 1) {
            // It's not very likely that we skip more than one slot as HTTP timeout is set
            // to SLOT_DURATION_MS so we will fail task before skipping another slot.
            this.logger.warn("Skipped slot due to task taking more than one slot to run", {
              skippedSlot: slot + 1,
            });
          }
          slotOrEpoch = nextSlot;
        } else {
          slotOrEpoch = computeEpochAtSlot(nextSlot);
        }
        slot = nextSlot;
      } catch (e) {
        if (e instanceof ErrorAborted) {
          return;
        }
        throw e;
      }
    }
  }

  private timeUntilNext(timeItem: TimeItem): number {
    const milliSecondsPerSlot = this.config.SLOT_DURATION_MS;
    const msFromGenesis = Date.now() - this.genesisTime * 1000;

    if (timeItem === TimeItem.Slot) {
      if (msFromGenesis >= 0) {
        return milliSecondsPerSlot - (msFromGenesis % milliSecondsPerSlot);
      }
      return Math.abs(msFromGenesis) % milliSecondsPerSlot;
    }
    const milliSecondsPerEpoch = SLOTS_PER_EPOCH * milliSecondsPerSlot;
    if (msFromGenesis >= 0) {
      return milliSecondsPerEpoch - (msFromGenesis % milliSecondsPerEpoch);
    }
    return Math.abs(msFromGenesis) % milliSecondsPerEpoch;
  }
}

/**
 * Same to the spec but we use Math.round instead of Math.floor.
 */
export function getCurrentSlotAround(config: ChainForkConfig, genesisTime: TimeSeconds): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  const slotsSinceGenesis = Math.round((diffInSeconds * 1000) / config.SLOT_DURATION_MS);
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
