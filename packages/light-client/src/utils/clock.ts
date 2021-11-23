import {AbortSignal} from "@chainsafe/abort-controller";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ErrorAborted, sleep} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

type OnEpochFn = (epoch: Epoch, signal: AbortSignal) => Promise<void>;

export interface IClock {
  readonly currentSlot: Slot;
  readonly genesisTime: number;
  start(signal: AbortSignal): void;
  runEveryEpoch(fn: OnEpochFn): void;
  /** Returns the slot if the internal clock were advanced by `toleranceSec`. */
  slotWithFutureTolerance(toleranceSec: number): Slot;
}

export class Clock implements IClock {
  private readonly onEveryEpochFns: OnEpochFn[] = [];

  constructor(
    private readonly config: IChainConfig,
    readonly genesisTime: number,
    private readonly onError?: (e: Error) => void
  ) {}

  get currentSlot(): Slot {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  /** Returns the slot if the internal clock were advanced by `toleranceSec`. */
  slotWithFutureTolerance(toleranceSec: number): Slot {
    // this is the same to getting slot at now + toleranceSec
    return getCurrentSlot(this.config, this.genesisTime - toleranceSec);
  }

  start(signal: AbortSignal): void {
    for (const fn of this.onEveryEpochFns) {
      this.runAtMostEveryEpoch(signal, fn).catch((e: Error) => {
        if (this.onError) this.onError(e);
      });
    }
  }

  runEveryEpoch(fn: OnEpochFn): void {
    this.onEveryEpochFns.push(fn);
  }

  /**
   * If a task happens to take more than one epoch to run, we might skip a epoch. This is unfortunate,
   * however the alternative is to *always* process every epoch, which has the chance of creating a
   * theoretically unlimited backlog of tasks. It was a conscious decision to choose to drop tasks
   * on an overloaded/latent system rather than overload it even more.
   */
  private async runAtMostEveryEpoch(signal: AbortSignal, fn: OnEpochFn): Promise<void> {
    while (!signal.aborted) {
      // Run immediatelly first
      await fn(this.currentSlot, signal);

      try {
        await sleep(timeUntilNextEpoch(this.config, this.genesisTime), signal);
      } catch (e) {
        if (e instanceof ErrorAborted) {
          return;
        }
        throw e;
      }
    }
  }
}

function timeUntilNextEpoch(config: Pick<IChainConfig, "SECONDS_PER_SLOT">, genesisTime: number): number {
  const miliSecondsPerEpoch = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000;
  const msFromGenesis = Date.now() - genesisTime * 1000;
  if (msFromGenesis >= 0) {
    return miliSecondsPerEpoch - (msFromGenesis % miliSecondsPerEpoch);
  } else {
    return Math.abs(msFromGenesis % miliSecondsPerEpoch);
  }
}
