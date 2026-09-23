import {FastifyInstance} from "fastify";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {defer, fetch, sleep} from "@lodestar/utils";
import {getClient} from "../../../../src/beacon/client/events.js";
import {BeaconEvent, Endpoints, EventType, getDefinitions} from "../../../../src/beacon/routes/events.js";
import {SSE_KEEP_ALIVE_INTERVAL_MS, getRoutes} from "../../../../src/beacon/server/events.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";
import {eventTestData} from "../testData/events.js";

describe("beacon / events", () => {
  const mockApi = getMockApi<Endpoints>(getDefinitions(config));
  let server: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    const res = getTestServer();
    server = res.server;
    for (const route of Object.values(getRoutes(config, mockApi))) {
      server.route(route);
    }

    baseUrl = await res.start();
  });

  afterAll(async () => {
    if (server !== undefined) await server.close();
  });

  let controller: AbortController;
  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => controller.abort());

  it("Closes the server subscription when the client aborts", async () => {
    const received = defer<void>();
    const disconnected = defer<void>();
    const onClose = vi.fn();
    mockApi.eventstream.mockImplementation(async ({signal, onEvent}) => {
      signal.addEventListener("abort", () => disconnected.resolve(), {once: true});
      onEvent({type: EventType.head, message: eventTestData[EventType.head]});
    });

    await getClient(config, baseUrl).eventstream({
      topics: [EventType.head, EventType.proposerPreferences],
      signal: controller.signal,
      onEvent: () => received.resolve(),
      onClose,
    });
    await received.promise;
    controller.abort();
    await disconnected.promise;

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Receive events", async () => {
    const eventHead1: BeaconEvent = {
      type: EventType.head,
      message: eventTestData[EventType.head],
    };
    const eventHead2: BeaconEvent = {
      type: EventType.head,
      message: {...eventTestData[EventType.head], slot: eventTestData[EventType.head].slot + 1},
    };
    const eventChainReorg: BeaconEvent = {
      type: EventType.chainReorg,
      message: eventTestData[EventType.chainReorg],
    };

    const topicsToRequest = [EventType.head, EventType.chainReorg];
    const eventsToSend: BeaconEvent[] = [eventHead1, eventHead2, eventChainReorg];
    const eventsReceived: BeaconEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      mockApi.eventstream.mockImplementation(async ({topics, onEvent}) => {
        try {
          expect(topics).toEqual(topicsToRequest);
          for (const event of eventsToSend) {
            onEvent(event);
            await sleep(5);
          }
        } catch (e) {
          reject(e);
        }
      });

      // Capture them on the client
      const client = getClient(config, baseUrl);
      void client.eventstream({
        topics: topicsToRequest,
        signal: controller.signal,
        onEvent: (event) => {
          eventsReceived.push(event);
          if (eventsReceived.length >= eventsToSend.length) resolve();
        },
      });
    });

    expect(eventsReceived).toEqual(eventsToSend);
  });

  it("Send the response headers before the first event", async () => {
    mockApi.eventstream.mockImplementation(async () => {});

    // Resolves once the response headers are received
    const res = await fetch(`${baseUrl}/eth/v1/events?topics=${EventType.chainReorg}`, {signal: controller.signal});

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("Write keep-alive comments to an idle stream", async () => {
    vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
    try {
      mockApi.eventstream.mockImplementation(async () => {});

      const res = await fetch(`${baseUrl}/eth/v1/events?topics=${EventType.chainReorg}`, {signal: controller.signal});
      const reader = res.body?.getReader();
      if (reader === undefined) throw Error("Missing response body");

      vi.advanceTimersByTime(SSE_KEEP_ALIVE_INTERVAL_MS);
      const {value} = await reader.read();

      expect(new TextDecoder().decode(value)).toBe(":\n\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Ignore keep-alive comments on the client", async () => {
    vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
    try {
      const eventHead: BeaconEvent = {
        type: EventType.head,
        message: eventTestData[EventType.head],
      };
      const subscribed = defer<(event: BeaconEvent) => void>();
      const received = defer<void>();
      const eventsReceived: BeaconEvent[] = [];
      const errorsReceived: Error[] = [];
      mockApi.eventstream.mockImplementation(async ({onEvent}) => subscribed.resolve(onEvent));

      void getClient(config, baseUrl).eventstream({
        topics: [EventType.head],
        signal: controller.signal,
        onEvent: (event) => {
          eventsReceived.push(event);
          received.resolve();
        },
        onError: (e) => {
          errorsReceived.push(e);
        },
      });

      const onEvent = await subscribed.promise;
      vi.advanceTimersByTime(SSE_KEEP_ALIVE_INTERVAL_MS);
      onEvent(eventHead);
      await received.promise;

      expect(eventsReceived).toEqual([eventHead]);
      expect(errorsReceived).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Keep the stream alive if an event can not be serialized", async () => {
    // Emitting an event whose `version` does not match its type is a bug on the emitting side and
    // must not happen, it is only used here to force a serialization failure. What matters is that
    // a single event that can not be serialized does not take the whole stream down with it.
    const invalidEvent = {
      type: EventType.proposerPreferences,
      message: {...eventTestData[EventType.proposerPreferences], version: ForkName.fulu},
    } as BeaconEvent;
    const eventHead: BeaconEvent = {
      type: EventType.head,
      message: eventTestData[EventType.head],
    };
    const eventsReceived: BeaconEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      mockApi.eventstream.mockImplementation(async ({onEvent}) => {
        try {
          // The error is surfaced to the caller instead of tearing down the connection
          expect(() => onEvent(invalidEvent)).toThrow();
          await sleep(5);
          onEvent(eventHead);
        } catch (e) {
          reject(e);
        }
      });

      const client = getClient(config, baseUrl);
      void client.eventstream({
        topics: [EventType.head, EventType.proposerPreferences],
        signal: controller.signal,
        onEvent: (event) => {
          eventsReceived.push(event);
          resolve();
        },
      });
    });

    expect(eventsReceived).toEqual([eventHead]);
  });

  it("Keep the stream alive if the event consumer throws", async () => {
    const eventHead1: BeaconEvent = {
      type: EventType.head,
      message: eventTestData[EventType.head],
    };
    const eventHead2: BeaconEvent = {
      type: EventType.head,
      message: {...eventTestData[EventType.head], slot: eventTestData[EventType.head].slot + 1},
    };
    const eventsReceived: BeaconEvent[] = [];
    const errorsReceived: Error[] = [];

    await new Promise<void>((resolve, reject) => {
      mockApi.eventstream.mockImplementation(async ({onEvent}) => {
        try {
          onEvent(eventHead1);
          await sleep(5);
          onEvent(eventHead2);
        } catch (e) {
          reject(e);
        }
      });

      const client = getClient(config, baseUrl);
      void client.eventstream({
        topics: [EventType.head],
        signal: controller.signal,
        onEvent: (event) => {
          eventsReceived.push(event);
          // Simulates a consumer failing on the first event, the next event must still be delivered
          if (eventsReceived.length === 1) throw Error("consumer failed");
          resolve();
        },
        onError: (e) => {
          errorsReceived.push(e);
        },
      });
    });

    expect(eventsReceived).toEqual([eventHead1, eventHead2]);
    expect(errorsReceived.map((e) => e.message)).toEqual(["consumer failed"]);
  });
});
