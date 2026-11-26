import {LinkedList} from "./array.js";
import {ThreadBoundaryError, fromThreadBoundaryError, toThreadBoundaryError} from "./error.js";

export type RequestEvent<T> = {
  callArgs: T;
  id: number;
};

export type RequestCancelEvent = {
  id: number;
};

export type ResponsePullEvent = {
  id: number;
  count: number;
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
  emitRequestCancel(data: RequestCancelEvent): void;
  emitResponse(data: IteratorEvent<Item>): void;
  emitResponsePull(data: ResponsePullEvent): void;
  onRequest(handler: (data: RequestEvent<Args>) => void): void;
  onRequestCancel(handler: (data: RequestCancelEvent) => void): void;
  onResponse(handler: (data: IteratorEvent<Item>) => void): void;
  onResponsePull(handler: (data: ResponsePullEvent) => void): void;
};

/**
 * Credit window bounding how far the handler may run ahead of the consumer. The consumer grants this
 * much credit up front and refunds one credit per item it pulls, so at most `window` items (plus one
 * in-flight read) are ever buffered across the bridge per request, regardless of read speed. Must be >= 1,
 * otherwise the handler parks on credit forever.
 */
export const RESP_BRIDGE_WINDOW = 2;

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

  constructor(
    private readonly events: Pick<
      AsyncIterableEventBus<Args, Item>,
      "onResponse" | "emitRequest" | "emitRequestCancel" | "emitResponsePull"
    >
  ) {
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
        // Grant the initial window; next() refunds one credit per consumed item
        self.events.emitResponsePull({id, count: RESP_BRIDGE_WINDOW});

        return {
          async next() {
            while (true) {
              const item = req.items.shift();
              if (item !== null) {
                self.events.emitResponsePull({id, count: 1});
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
            // Without the cancel the handler keeps producing items that cross the thread boundary just to be dropped
            if (self.pending.delete(id)) {
              self.events.emitRequestCancel({id});
            }
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

type HandlerState<Item> = {
  iterator: AsyncIterator<Item>;
  credit: number;
  cancelled: boolean;
  onCredit: null | (() => void);
};

export class AsyncIterableBridgeHandler<Args, Item> {
  private readonly states = new Map<number, HandlerState<Item>>();

  constructor(
    private readonly events: Pick<
      AsyncIterableEventBus<Args, Item>,
      "onRequest" | "onRequestCancel" | "emitResponse" | "onResponsePull"
    >,
    private readonly handler: (args: Args) => AsyncIterable<Item>
  ) {
    events.onRequest(this.onRequest.bind(this));
    events.onRequestCancel(this.onRequestCancel.bind(this));
    events.onResponsePull(this.onResponsePull.bind(this));
  }

  get iteratingCount(): number {
    return this.states.size;
  }

  private async onRequest(data: RequestEvent<Args>): Promise<void> {
    let state: HandlerState<Item> | undefined;
    try {
      state = {
        iterator: this.handler(data.callArgs)[Symbol.asyncIterator](),
        credit: 0,
        cancelled: false,
        onCredit: null,
      };
      this.states.set(data.id, state);

      while (true) {
        await this.waitForCredit(state);
        if (state.cancelled) {
          break;
        }
        state.credit--;

        const result = await state.iterator.next();
        if (result.done || state.cancelled) {
          break;
        }

        this.events.emitResponse({
          type: IteratorEventType.next,
          id: data.id,
          item: result.value,
        });
      }

      if (!state.cancelled) {
        this.events.emitResponse({
          type: IteratorEventType.done,
          id: data.id,
        });
      }
    } catch (e) {
      if (!state?.cancelled) {
        this.events.emitResponse({
          type: IteratorEventType.error,
          id: data.id,
          error: toThreadBoundaryError(e as Error),
        });
      }
    } finally {
      this.states.delete(data.id);
    }
  }

  private waitForCredit(state: HandlerState<Item>): Promise<void> {
    if (state.credit > 0 || state.cancelled) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      state.onCredit = resolve;
    });
  }

  private onResponsePull(data: ResponsePullEvent): void {
    const state = this.states.get(data.id);
    if (!state) {
      return;
    }
    state.credit += data.count;
    state.onCredit?.();
    state.onCredit = null;
  }

  private onRequestCancel(data: RequestCancelEvent): void {
    const state = this.states.get(data.id);
    if (!state) {
      return;
    }
    // Unblock the loop if it is parked on credit so it can observe the cancel and stop
    state.cancelled = true;
    state.onCredit?.();
    state.onCredit = null;

    // An async generator queues return() behind the next() that is in flight, so at most one more
    // item is produced before its finally blocks run. Any error surfaces through that next() call.
    void state.iterator.return?.().catch(() => {});
  }
}
