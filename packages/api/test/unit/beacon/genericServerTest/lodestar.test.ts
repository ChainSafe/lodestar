import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {getClient} from "../../../../src/beacon/client/lodestar.js";
import {Endpoints, getDefinitions} from "../../../../src/beacon/routes/lodestar.js";
import {getRoutes} from "../../../../src/beacon/server/lodestar.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {AnyEndpoint} from "../../../../src/utils/codecs.js";
import {FastifyRoute} from "../../../../src/utils/server/index.js";
import {WireFormat} from "../../../../src/utils/wireFormat.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";

describe("beacon / lodestar", () => {
  describe("json only endpoints", () => {
    const mockApi = getMockApi<Endpoints>(getDefinitions(config));
    let baseUrl: string;
    let server: FastifyInstance;

    beforeAll(async () => {
      const res = getTestServer();
      server = res.server;
      for (const route of Object.values(getRoutes(config, mockApi))) {
        server.route(route as FastifyRoute<AnyEndpoint>);
      }
      baseUrl = await res.start();
    });

    afterAll(async () => {
      if (server !== undefined) await server.close();
    });

    it("getFastConfirmationInfo", async () => {
      mockApi.getFastConfirmationInfo.mockResolvedValue({
        data: {
          confirmed: {root: "0xaa", slot: 100},
          head: {root: "0xbb", slot: 102},
          justifiedCheckpoint: {root: "0xcc", epoch: 3},
          finalizedCheckpoint: {root: "0xdd", epoch: 2},
          previousEpochObservedJustifiedCheckpoint: {root: "0xee", epoch: 2},
          currentEpochObservedJustifiedCheckpoint: {root: "0xff", epoch: 3},
          previousEpochGreatestUnrealizedCheckpoint: {root: "0x11", epoch: 2},
          previousSlotHead: "0x22",
          currentSlotHead: "0x33",
        },
      });

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const res = await client.getFastConfirmationInfo();

      expect(res.ok).toBe(true);
      expect(res.wireFormat()).toBe(WireFormat.json);
      expect(res.json().data).toStrictEqual({
        confirmed: {root: "0xaa", slot: 100},
        head: {root: "0xbb", slot: 102},
        justified_checkpoint: {root: "0xcc", epoch: 3},
        finalized_checkpoint: {root: "0xdd", epoch: 2},
        previous_epoch_observed_justified_checkpoint: {root: "0xee", epoch: 2},
        current_epoch_observed_justified_checkpoint: {root: "0xff", epoch: 3},
        previous_epoch_greatest_unrealized_checkpoint: {root: "0x11", epoch: 2},
        previous_slot_head: "0x22",
        current_slot_head: "0x33",
      });
    });

    it("getHistoricalSummaries", async () => {
      mockApi.getHistoricalSummaries.mockResolvedValue({
        data: {
          slot: 0,
          historicalSummaries: [],
          proof: [],
        },
        meta: {version: ForkName.electra, executionOptimistic: false, finalized: false},
      });

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const res = await client.getHistoricalSummaries({stateId: "head"}, {responseWireFormat: WireFormat.json});

      expect(res.ok).toBe(true);
      expect(res.wireFormat()).toBe(WireFormat.json);
      expect(res.json().data).toStrictEqual({
        slot: "0",
        historical_summaries: [],
        proof: [],
      });
    });
  });
});
