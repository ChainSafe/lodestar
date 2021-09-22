import {ChainEventEmitter} from "../../emitter";

/**
 * Utility to buffer events and send them all at once afterwards
 */
export class PendingEvents {
  events: Parameters<ChainEventEmitter["emit"]>[] = [];
  constructor(private readonly emitter: ChainEventEmitter) {}

  push: ChainEventEmitter["emit"] = (...args: Parameters<ChainEventEmitter["emit"]>) => {
    this.events.push(args);
  };

  emit(): void {
    for (const event of this.events) {
      this.emitter.emit(...event);
    }
  }
}
