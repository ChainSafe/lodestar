import {config} from "@lodestar/config/default";
import {sleep} from "@lodestar/utils";
import {FastifyInstance} from "fastify";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest";
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
});
