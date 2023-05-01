import EventEmitter from "node:events";
import StrictEventEmitter from "strict-event-emitter-types";
import {expect} from "chai";
import all from "it-all";
import {sleep} from "@lodestar/utils";
import {
  AsyncIterableBridgeCaller,
  AsyncIterableBridgeHandler,
  AsyncIterableEventBus,
  IteratorEvent,
  RequestEvent,
} from "../../../../src/network/reqresp/utils/asyncIterableToEvents.js";

enum FnEvent {
  request = "request",
  response = "response",
}

type RequestArgs = {
  num: number;
};

type ResponseItem = {
  num: number;
};

type FnEvents = {
  [FnEvent.request]: (data: RequestEvent<RequestArgs>) => void;
  [FnEvent.response]: (data: IteratorEvent<ResponseItem>) => void;
};

type IFnEventBus = StrictEventEmitter<EventEmitter, FnEvents>;

class FnEventBus extends (EventEmitter as {new (): IFnEventBus}) {}

describe("reqresp asyncIterableToEvents", () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function getParts(handlerFn: (args: RequestArgs) => AsyncIterable<ResponseItem>) {
    const eventBus = new FnEventBus();
    const events: AsyncIterableEventBus<RequestArgs, ResponseItem> = {
      emitRequest: (data) => eventBus.emit(FnEvent.request, data),
      emitResponse: (data) => eventBus.emit(FnEvent.response, data),
      onRequest: (cb) => eventBus.on(FnEvent.request, cb),
      onResponse: (cb) => eventBus.on(FnEvent.response, cb),
    };

    if (process.env.DEBUG) {
      for (const ev of Object.keys(FnEvent)) {
        eventBus.on(ev as any, (data) => {
          // eslint-disable-next-line no-console
          console.log(ev, data);
        });
      }
    }

    const caller = new AsyncIterableBridgeCaller<RequestArgs, ResponseItem>(events);
    const handler = new AsyncIterableBridgeHandler<RequestArgs, ResponseItem>(events, handlerFn);

    return {caller, handler};
  }

  async function runTest(
    args: RequestArgs,
    handler: (args: RequestArgs) => AsyncIterable<ResponseItem>,
    expectedItems: ResponseItem[]
  ): Promise<void> {
    const {caller} = getParts(handler);
    const items = await all(caller.getAsyncIterable(args));
    expect(items).deep.equals(expectedItems);
  }

  const testError = "TEST_ERROR";

  it("no items", async () => {
    await runTest(
      {num: 0},
      // eslint-disable-next-line require-yield
      async function* () {
        await sleep(0);
      },
      []
    );
  });

  it("some items", async () => {
    await runTest(
      {num: 10},
      async function* (args) {
        await sleep(0);
        yield {num: args.num};
        await sleep(0);
        yield {num: args.num + 1};
        await sleep(0);
      },
      [{num: 10}, {num: 11}]
    );
  });

  it("throw error", async () => {
    await expect(
      runTest(
        {num: 10},
        // eslint-disable-next-line require-yield
        async function* () {
          await sleep(0);
          throw Error("TEST_ERROR");
        },
        []
      )
    ).rejectedWith(testError);
  });

  it("throw error after items", async () => {
    await expect(
      runTest(
        {num: 10},
        async function* (args) {
          await sleep(0);
          yield {num: args.num};
          await sleep(0);
          yield {num: args.num + 1};
          await sleep(0);
          throw Error(testError);
        },
        []
      )
    ).rejectedWith(testError);
  });

  it("throw error after items recv", async () => {
    const {caller} = getParts(async function* (args) {
      await sleep(0);
      yield {num: args.num};
      await sleep(0);
      yield {num: args.num + 1};
      await sleep(0);
      throw Error(testError);
    });

    const items: ResponseItem[] = [];

    await expect(
      (async function allGrab() {
        for await (const item of caller.getAsyncIterable({num: 10})) {
          items.push(item);
        }
      })()
    ).rejectedWith(testError);

    expect(items).deep.equals([{num: 10}, {num: 11}]);
  });
});
