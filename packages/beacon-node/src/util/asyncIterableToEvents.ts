import {LinkedList} from "./array.js";
import {ThreadBoundaryError, fromThreadBoundaryError, toThreadBoundaryError} from "./error.js";

export type RequestEvent<T> = {
  callArgs: T;
  id: number;
};

export enum IteratorEventType {
  next = "iterator.next",
  done = "iterator.done",
  error = "iterator.error",
}

export type IteratorEvent<V> =
  | {type: IteratorEventType.next; id: number; item: V}
  | {type: IteratorEventType.done; id: number}
  | {type: IteratorEventType.error; id: number; error: ThreadBoundaryError};

export type AsyncIterableEventBus<Args, Item> = {
  emitRequest(data: RequestEvent<Args>): void;
  emitResponse(data: IteratorEvent<Item>): void;
  onRequest(handler: (data: RequestEvent<Args>) => void): void;
  onResponse(handler: (data: IteratorEvent<Item>) => void): void;
};

type PendingItem<T> = {
  items: LinkedList<T>;
  done: boolean;
  error: null | Error;
  onNext: null | (() => void);
};

export class AsyncIterableBridgeCaller<Args, Item> {
  private nextRequestId = 0;

  // TODO: Consider expiring the requests after no reply for long enough, t
  private readonly pending = new Map<number, PendingItem<Item>>();

  constructor(private readonly events: Pick<AsyncIterableEventBus<Args, Item>, "onResponse" | "emitRequest">) {
    events.onResponse(this.onResponse.bind(this));
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  getAsyncIterable(callArgs: Args): AsyncIterable<Item> {
    const self = this;

    return {
      [Symbol.asyncIterator]() {
        const id = self.nextRequestId++;
        const req: PendingItem<Item> = {
          items: new LinkedList(),
          done: false,
          error: null,
          onNext: null,
        };
        self.pending.set(id, req);

        self.events.emitRequest({
          callArgs,
          id,
        });

        return {
          async next() {
            while (true) {
              const item = req.items.shift();
              if (item !== null) {
                return {value: item, done: false};
              }

              if (req.error) {
                throw req.error;
              }

              if (req.done) {
                // Is it correct to return undefined on done: true?
                return {value: undefined as unknown as Item, done: true};
              }

              await new Promise<void>((resolve) => {
                req.onNext = resolve;
              });
            }
          },

          async return() {
            // This will be reached if the consumer called 'break' or 'return' early in the loop.
            self.pending.delete(id);
            return {value: undefined, done: true};
          },
        };
      },
    };
  }

  private onResponse(data: IteratorEvent<Item>): void {
    const req = this.pending.get(data.id);
    if (!req) {
      // TODO: Log or track, can happen if consumer returns source early
      return;
    }

    switch (data.type) {
      case IteratorEventType.done:
        // What if it's already done?
        req.done = true;

        // Do not expect more responses
        this.pending.delete(data.id);
        break;

      case IteratorEventType.error:
        // What if there's already an error?
        req.error = fromThreadBoundaryError(data.error);

        // Do not expect more responses
        this.pending.delete(data.id);
        break;

      case IteratorEventType.next:
        // Should check that's it's already done or error?
        req.items.push(data.item);
        break;
    }

    req.onNext?.();
  }
}

export class AsyncIterableBridgeHandler<Args, Item> {
  constructor(
    private readonly events: Pick<AsyncIterableEventBus<Args, Item>, "onRequest" | "emitResponse">,
    private readonly handler: (args: Args) => AsyncIterable<Item>
  ) {
    events.onRequest(this.onRequest.bind(this));
  }

  private async onRequest(data: RequestEvent<Args>): Promise<void> {
    try {
      for await (const item of this.handler(data.callArgs)) {
        this.events.emitResponse({
          type: IteratorEventType.next,
          id: data.id,
          item,
        });
      }

      this.events.emitResponse({
        type: IteratorEventType.done,
        id: data.id,
      });
    } catch (e) {
      this.events.emitResponse({
        type: IteratorEventType.error,
        id: data.id,
        error: toThreadBoundaryError(e as Error),
      });
    }
  }
}
