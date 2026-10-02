import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {getClient} from "../../../../src/beacon/client/lodestar.js";
import {Endpoints, FastConfirmationInfoType, getDefinitions} from "../../../../src/beacon/routes/lodestar.js";
import {getRoutes} from "../../../../src/beacon/server/lodestar.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {AnyEndpoint} from "../../../../src/utils/codecs.js";
import {FastifyRoute} from "../../../../src/utils/server/index.js";
import {WireFormat} from "../../../../src/utils/wireFormat.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";

describe("beacon / lodestar", () => {
  describe("route responses", () => {
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
      const root = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);
      const data = {
        confirmed: {root: root(0xaa), slot: 100},
        head: {root: root(0xbb), slot: 102},
        justifiedCheckpoint: {root: root(0xcc), epoch: 3},
        finalizedCheckpoint: {root: root(0xdd), epoch: 2},
        previousEpochObservedJustifiedCheckpoint: {root: root(0xee), epoch: 2},
        currentEpochObservedJustifiedCheckpoint: {root: root(0xff), epoch: 3},
        previousEpochGreatestUnrealizedCheckpoint: {root: root(0x11), epoch: 2},
        previousSlotHead: root(0x22),
        currentSlotHead: root(0x33),
      };
      mockApi.getFastConfirmationInfo.mockResolvedValue({data});

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const resJson = await client.getFastConfirmationInfo({responseWireFormat: WireFormat.json});

      expect(resJson.ok).toBe(true);
      expect(resJson.wireFormat()).toBe(WireFormat.json);
      expect(resJson.json().data).toStrictEqual({
        confirmed: {root: toHexString(root(0xaa)), slot: "100"},
        head: {root: toHexString(root(0xbb)), slot: "102"},
        justified_checkpoint: {root: toHexString(root(0xcc)), epoch: "3"},
        finalized_checkpoint: {root: toHexString(root(0xdd)), epoch: "2"},
        previous_epoch_observed_justified_checkpoint: {root: toHexString(root(0xee)), epoch: "2"},
        current_epoch_observed_justified_checkpoint: {root: toHexString(root(0xff)), epoch: "3"},
        previous_epoch_greatest_unrealized_checkpoint: {root: toHexString(root(0x11)), epoch: "2"},
        previous_slot_head: toHexString(root(0x22)),
        current_slot_head: toHexString(root(0x33)),
      });

      const resSsz = await client.getFastConfirmationInfo({responseWireFormat: WireFormat.ssz});

      expect(resSsz.ok).toBe(true);
      expect(resSsz.wireFormat()).toBe(WireFormat.ssz);
      expect(toHexString(resSsz.ssz())).toBe(toHexString(FastConfirmationInfoType.serialize(data)));
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
