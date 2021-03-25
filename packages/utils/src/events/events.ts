import {EventIterator} from "event-iterator";
import {EventIteratorOptions, ListenHandler} from "event-iterator/src/event-iterator";

export interface IStoppableEventIterable<T> extends AsyncIterable<T> {
  stop(): void;
}

export class LodestarEventIterator<T> implements IStoppableEventIterable<T> {
  [Symbol.asyncIterator]: () => AsyncIterator<T>;
  private stopCallback?: () => void;

  constructor(listenHandler: ListenHandler<T>, options: Partial<EventIteratorOptions> = {}) {
    const handler: ListenHandler<T> = (queue) => {
      this.stopCallback = queue.stop;
      return listenHandler(queue);
    };
    const iterator = new EventIterator(handler, options);
    this[Symbol.asyncIterator] = () => iterator[Symbol.asyncIterator]();
  }

  stop(): void {
    if (this.stopCallback) {
      this.stopCallback();
    }
  }
}
