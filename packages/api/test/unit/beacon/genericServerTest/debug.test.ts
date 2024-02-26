import {describe, it, expect, MockInstance, beforeAll, afterAll, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {FastifyInstance} from "fastify";
import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {Api, ReqTypes, routesData} from "../../../../src/beacon/routes/debug.js";
import {getClient} from "../../../../src/beacon/client/debug.js";
import {getRoutes} from "../../../../src/beacon/server/debug.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";
import {registerRoute} from "../../../../src/utils/server/registerRoute.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {testData} from "../testData/debug.js";

describe("beacon / debug", () => {
  // Extend timeout since states are very big
  vi.setConfig({testTimeout: 30_000});

  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);

  // Get state by SSZ

  describe("getState() in SSZ format", () => {
    const mockApi = getMockApi<Api>(routesData);
    let baseUrl: string;
    let server: FastifyInstance;

    beforeAll(async () => {
      const res = getTestServer();
      server = res.server;
      for (const route of Object.values(getRoutes(config, mockApi))) {
        registerRoute(server, route);
      }
      baseUrl = await res.start();
    });

    afterAll(async () => {
      if (server !== undefined) await server.close();
    });

    for (const method of ["getState" as const, "getStateV2" as const]) {
      it(method, async () => {
        const state = ssz.phase0.BeaconState.defaultValue();
        const stateSerialized = ssz.phase0.BeaconState.serialize(state);
        (mockApi[method] as MockInstance).mockResolvedValue(stateSerialized);

        const httpClient = new HttpClient({baseUrl});
        const client = getClient(config, httpClient);

        const res = await client[method]("head", "ssz");

        expect(res.ok).toBe(true);

        if (res.ok) {
          expect(toHexString(res.response)).toBe(toHexString(stateSerialized));
        }
      });
    }
  });
});
