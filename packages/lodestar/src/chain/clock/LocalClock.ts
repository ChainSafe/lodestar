import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {ChainEventEmitter} from "../emitter";

import {IBeaconClock} from "./interface";

/**
 * A local clock, the clock time is assumed to be trusted
 */
export class LocalClock implements IBeaconClock {
  private readonly config: IBeaconConfig;
  private readonly genesisTime: number;
  private timeoutId: NodeJS.Timeout;
  private readonly emitter: ChainEventEmitter;
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
    emitter: ChainEventEmitter;
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

  public get currentSlot(): Slot {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  public get currentEpoch(): Epoch {
    return computeEpochAtSlot(this.config, this.currentSlot);
  }

  public abort = (): void => {
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
      this.emitter.emit("clock:slot", this._currentSlot);
      const previousEpoch = computeEpochAtSlot(this.config, previousSlot);
      const currentEpoch = computeEpochAtSlot(this.config, this._currentSlot);
      if (previousEpoch < currentEpoch) {
        this.emitter.emit("clock:epoch", currentEpoch);
      }
    }
    //recursively invoke onNextSlot
    this.timeoutId = setTimeout(this.onNextSlot, this.msUntilNextSlot());
  };

  private msUntilNextSlot(): number {
    const {SECONDS_PER_SLOT} = this.config.params;
    const diffInSeconds = Math.floor(Date.now() / 1000 - this.genesisTime);
    return (SECONDS_PER_SLOT - (diffInSeconds % SECONDS_PER_SLOT)) * 1000;
  }
}
