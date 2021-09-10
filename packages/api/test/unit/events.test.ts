import {AbortController} from "@chainsafe/abort-controller";
import {sleep} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/default";
import {Api, routesData, EventType, BeaconEvent} from "../../src/routes/events";
import {getClient} from "../../src/client/events";
import {getRoutes} from "../../src/server/events";
import {getMockApi, getTestServer} from "../utils/utils";
import {registerRoutesGroup} from "../../src/server";
import {expect} from "chai";

describe("events", () => {
  const rootHex = "0x" + "01".repeat(32);
  const {baseUrl, server} = getTestServer();
  const mockApi = getMockApi<Api>(routesData);
  const routes = getRoutes(config, mockApi);
  registerRoutesGroup(server, routes);

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Receive events", async () => {
    const eventHead1: BeaconEvent = {
      type: EventType.head,
      message: {
        slot: 1,
        block: rootHex,
        state: rootHex,
        epochTransition: false,
        previousDutyDependentRoot: rootHex,
        currentDutyDependentRoot: rootHex,
      },
    };
    const eventHead2: BeaconEvent = {
      type: EventType.head,
      message: {
        slot: 2,
        block: rootHex,
        state: rootHex,
        epochTransition: true,
        previousDutyDependentRoot: rootHex,
        currentDutyDependentRoot: rootHex,
      },
    };
    const eventChainReorg: BeaconEvent = {
      type: EventType.chainReorg,
      message: {
        slot: 3,
        depth: 2,
        oldHeadBlock: rootHex,
        newHeadBlock: rootHex,
        oldHeadState: rootHex,
        newHeadState: rootHex,
        epoch: 1,
      },
    };

    const topicsToRequest = [EventType.head, EventType.chainReorg];
    const eventsToSend: BeaconEvent[] = [eventHead1, eventHead2, eventChainReorg];
    const eventsReceived: BeaconEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      mockApi.eventstream.callsFake(async (topics, signal, onEvent) => {
        try {
          expect(topics).to.deep.equal(topicsToRequest, "Wrong received topics");
          for (const event of eventsToSend) {
            onEvent(event);
            await sleep(5);
          }
        } catch (e) {
          reject(e as Error);
        }
      });

      // Capture them on the client
      const client = getClient(config, baseUrl);
      client.eventstream(topicsToRequest, controller.signal, (event) => {
        eventsReceived.push(event);
        if (eventsReceived.length >= eventsToSend.length) resolve();
      });
    });

    expect(eventsReceived).to.deep.equal(eventsToSend, "Wrong received events");
  });
});
