import {FastifyInstance} from "fastify";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {sleep} from "@lodestar/utils";
import {getClient} from "../../../../src/beacon/client/events.js";
import {BeaconEvent, Endpoints, EventType, getDefinitions} from "../../../../src/beacon/routes/events.js";
import {getRoutes} from "../../../../src/beacon/server/events.js";
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
