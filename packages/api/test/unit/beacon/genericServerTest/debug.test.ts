import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getClient} from "../../../../src/beacon/client/debug.js";
import {Endpoints, getDefinitions} from "../../../../src/beacon/routes/debug.js";
import {getRoutes} from "../../../../src/beacon/server/debug.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {AnyEndpoint} from "../../../../src/utils/codecs.js";
import {FastifyRoute} from "../../../../src/utils/server/index.js";
import {WireFormat} from "../../../../src/utils/wireFormat.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";
import {testData} from "../testData/debug.js";

describe("beacon / debug", () => {
  // Extend timeout since states are very big
  vi.setConfig({testTimeout: 30_000});

  const config = createChainForkConfig({...defaultChainConfig, ELECTRA_FORK_EPOCH: 0});

  runGenericServerTest<Endpoints>(config, getClient, getRoutes, testData);

  describe("response encoding", () => {
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

    it("wraps fork choice v2 in data and preserves free-form extra data", async () => {
      mockApi.getDebugForkChoiceV2.mockResolvedValue(testData.getDebugForkChoiceV2.res);
      const response = await server.inject({method: "GET", url: "/eth/v2/debug/fork_choice"});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: {
          fork_choice_nodes: [
            {weight: "18446744073709551615", parent_payload_status: null, extra_data: {}},
            {
              parent_payload_status: "full",
              payload_attester_count: "3",
              extra_data: {client_field: {nested_value: "42"}},
            },
          ],
        },
      });
      expect(response.json()).not.toHaveProperty("fork_choice_nodes");
    });

    it("accepts fork choice v2 responses with empty extra data", async () => {
      const data = structuredClone(testData.getDebugForkChoiceV2.res.data);
      if (data instanceof Uint8Array) throw Error("Expected JSON fixture");
      data.extraData = {};
      for (const node of data.forkChoiceNodes) node.extraData = {};
      mockApi.getDebugForkChoiceV2.mockResolvedValue({data});
      const client = getClient(config, new HttpClient({baseUrl}));
      const response = await client.getDebugForkChoiceV2();
      expect(response.value()).toEqual(data);
    });

    it.each(["response", "node"])("rejects fork choice v2 with missing %s extra data", (location) => {
      const codec = getDefinitions(config).getDebugForkChoiceV2.resp.data;
      const data = testData.getDebugForkChoiceV2.res.data;
      if (data instanceof Uint8Array) throw Error("Expected JSON fixture");
      const json = codec.toJson(data, undefined) as {
        extra_data?: unknown;
        fork_choice_nodes: {extra_data?: unknown}[];
      };
      if (location === "response") delete json.extra_data;
      else delete json.fork_choice_nodes[0].extra_data;
      expect(() => codec.fromJson(json, undefined)).toThrow("extra_data must be an object");
    });

    it("getStateV2", async () => {
      const state = ssz.electra.BeaconState.defaultValue();
      const stateSerialized = ssz.electra.BeaconState.serialize(state);
      mockApi.getStateV2.mockResolvedValue({
        data: stateSerialized,
        meta: {version: ForkName.electra, executionOptimistic: false, finalized: false},
      });

      const httpClient = new HttpClient({baseUrl});
      const client = getClient(config, httpClient);

      const res = await client.getStateV2({stateId: "head"}, {responseWireFormat: WireFormat.ssz});

      expect(res.ok).toBe(true);
      expect(res.wireFormat()).toBe(WireFormat.ssz);
      expect(toHexString(res.ssz())).toBe(toHexString(stateSerialized));
    });
  });
});
