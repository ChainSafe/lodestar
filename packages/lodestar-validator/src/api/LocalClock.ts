import {AbortSignal} from "abort-controller";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {sleep, ErrorAborted} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ApiClientEventEmitter, IBeaconClock} from "./interface";
import {ClockEventType} from "./interface/clock";

/**
 * A local clock, the clock time is assumed to be trusted
 */
export class LocalClock implements IBeaconClock {
  private readonly config: IBeaconConfig;
  private readonly genesisTime: number;
  private readonly emitter: ApiClientEventEmitter;
  private readonly signal?: AbortSignal;
  private _currentSlot: number;

  public constructor({
    config,
    genesisTime,
    emitter,
    signal,
  }: {
    config: IBeaconConfig;
    genesisTime: number;
    emitter: ApiClientEventEmitter;
    signal?: AbortSignal;
  }) {
    this.config = config;
    this.genesisTime = genesisTime;
    this.signal = signal;
    this.emitter = emitter;

    this._currentSlot = getCurrentSlot(this.config, this.genesisTime);
    this.start().catch((e) => {
      if (e instanceof ErrorAborted) {
        // Aborted
      } else {
        throw e;
      }
    });
  }

  public get currentSlot(): Slot {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  public get currentEpoch(): Epoch {
    return computeEpochAtSlot(this.config, this.currentSlot);
  }

  private async start(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.onNextSlot();
      await sleep(this.msUntilNextSlot(), this.signal);
    }
  }

  private onNextSlot = (): void => {
    const clockSlot = getCurrentSlot(this.config, this.genesisTime);
    // process multiple clock slots in the case the main thread has been saturated for > SECONDS_PER_SLOT
    while (this._currentSlot < clockSlot) {
      const previousSlot = this._currentSlot;
      this._currentSlot++;
      this.emitter.emit(ClockEventType.CLOCK_SLOT, {
        slot: this._currentSlot,
      });
      const previousEpoch = computeEpochAtSlot(this.config, previousSlot);
      const currentEpoch = computeEpochAtSlot(this.config, this._currentSlot);
      if (previousEpoch < currentEpoch) {
        this.emitter.emit(ClockEventType.CLOCK_EPOCH, {
          epoch: currentEpoch,
        });
      }
    }
  };

  private msUntilNextSlot(): number {
    const {SECONDS_PER_SLOT} = this.config.params;
    const miliSecondsPerSlot = SECONDS_PER_SLOT * 1000;
    const diffInMiliSeconds = Date.now() - this.genesisTime * 1000;
    return miliSecondsPerSlot - (diffInMiliSeconds % miliSecondsPerSlot);
  }
}
