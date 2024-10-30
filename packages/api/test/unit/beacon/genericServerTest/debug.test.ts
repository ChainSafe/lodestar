import {toHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {FastifyInstance} from "fastify";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
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

  runGenericServerTest<Endpoints>(config, getClient, getRoutes, testData);

  // Get state by SSZ

  describe("get state in SSZ format", () => {
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

    it("getStateV2", async () => {
      const state = ssz.deneb.BeaconState.defaultValue();
      const stateSerialized = ssz.deneb.BeaconState.serialize(state);
      mockApi.getStateV2.mockResolvedValue({
        data: stateSerialized,
        meta: {version: ForkName.deneb, executionOptimistic: false, finalized: false},
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
