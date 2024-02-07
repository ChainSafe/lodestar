import {describe, it, expect, beforeEach, afterEach, beforeAll, afterAll} from "vitest";
import {FastifyInstance} from "fastify";
import {sleep} from "@lodestar/utils";
import {Api, routesData, EventType, BeaconEvent} from "../../../../src/beacon/routes/events.js";
import {getClient} from "../../../../src/beacon/client/events.js";
import {getRoutes} from "../../../../src/beacon/server/events.js";
import {registerRoute} from "../../../../src/utils/server/registerRoute.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";
import {eventTestData} from "../testData/events.js";

describe("beacon / events", () => {
  const mockApi = getMockApi<Api>(routesData);
  let server: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    const res = getTestServer();
    server = res.server;
    for (const route of Object.values(getRoutes(mockApi))) {
      registerRoute(server, route);
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
      mockApi.eventstream.mockImplementation(async (topics, signal, onEvent) => {
        try {
          expect(topics).toEqual(topicsToRequest);
          for (const event of eventsToSend) {
            onEvent(event);
            await sleep(5);
          }
        } catch (e) {
          reject(e as Error);
        }
      });

      // Capture them on the client
      const client = getClient(baseUrl);
      void client.eventstream(topicsToRequest, controller.signal, (event) => {
        eventsReceived.push(event);
        if (eventsReceived.length >= eventsToSend.length) resolve();
      });
    });

    expect(eventsReceived).toEqual(eventsToSend);
  });
});
