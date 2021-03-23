import {AbortSignal} from "abort-controller";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ApiClientEventEmitter, IBeaconClock} from "./interface";
import {ClockEventType} from "./interface/clock";

/**
 * A local clock, the clock time is assumed to be trusted
 */
export class LocalClock implements IBeaconClock {
  private readonly config: IBeaconConfig;
  private readonly genesisTime: number;
  private timeoutId: NodeJS.Timeout;
  private readonly emitter: ApiClientEventEmitter;
  private readonly signal?: AbortSignal;
  private _currentSlot: number;

  constructor({
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
    this.timeoutId = setTimeout(this.onNextSlot, this.msUntilNextSlot());
    this.signal = signal;
    this.emitter = emitter;
    this._currentSlot = getCurrentSlot(this.config, this.genesisTime);
    if (this.signal) {
      this.signal.addEventListener("abort", this.abort);
    }
  }

  get currentSlot(): Slot {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  get currentEpoch(): Epoch {
    return computeEpochAtSlot(this.config, this.currentSlot);
  }

  private abort = (): void => {
    clearTimeout(this.timeoutId);
    if (this.signal) {
      this.signal.removeEventListener("abort", this.abort);
    }
  };

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
    // recursively invoke onNextSlot
    this.timeoutId = setTimeout(this.onNextSlot, this.msUntilNextSlot());
  };

  private msUntilNextSlot(): number {
    const {SECONDS_PER_SLOT} = this.config.params;
    const miliSecondsPerSlot = SECONDS_PER_SLOT * 1000;
    const diffInMiliSeconds = Date.now() - this.genesisTime * 1000;
    return miliSecondsPerSlot - (diffInMiliSeconds % miliSecondsPerSlot);
  }
}
