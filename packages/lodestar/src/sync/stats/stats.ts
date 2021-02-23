import {ISyncStats} from "./interface";
import {Slot} from "@chainsafe/lodestar-types";
import {RateCounter} from "./rate";
import {ChainEvent, ChainEventEmitter} from "../../chain";

export class SyncStats implements ISyncStats {
  private readonly chainEvents: ChainEventEmitter;
  private readonly rateCounter: RateCounter;

  public constructor(chainEvents: ChainEventEmitter, rateCounter?: RateCounter) {
    this.chainEvents = chainEvents;
    this.rateCounter = rateCounter || new RateCounter(30);
  }

  public start(): void {
    this.rateCounter.start();
    this.chainEvents.on(ChainEvent.block, this.onBlockProcessed);
  }

  public stop(): void {
    this.chainEvents.off(ChainEvent.block, this.onBlockProcessed);
    this.rateCounter.stop();
  }

  public getEstimate(headSlot: Slot, targetSlot: Slot): number {
    const rate = this.getSyncSpeed();
    if (rate === 0) {
      return Infinity;
    }
    const slotsToSync = targetSlot - headSlot;
    if (slotsToSync > 0) {
      return Math.round(slotsToSync / rate);
    }
    return 0;
  }

  public getSyncSpeed(): number {
    return Math.round(this.rateCounter.rate() * 10) / 10;
  }

  private onBlockProcessed = (): void => {
    this.rateCounter.increment();
  };
}
