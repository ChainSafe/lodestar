import {describe, it, expect, beforeAll, afterAll, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {FastifyInstance} from "fastify";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {Endpoints, definitions} from "../../../../src/beacon/routes/debug.js";
import {getClient} from "../../../../src/beacon/client/debug.js";
import {getRoutes} from "../../../../src/beacon/server/debug.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {testData} from "../testData/debug.js";
import {FastifyRoute} from "../../../../src/index.js";
import {AnyEndpoint} from "../../../../src/utils/codecs.js";
import {WireFormat} from "../../../../src/utils/headers.js";

describe("beacon / debug", () => {
  // Extend timeout since states are very big
  vi.setConfig({testTimeout: 30_000});

  runGenericServerTest<Endpoints>(config, getClient, getRoutes, testData);

  // Get state by SSZ

  describe("getState() in SSZ format", () => {
    const mockApi = getMockApi<Endpoints>(definitions);
    let baseUrl: string;
    let server: FastifyInstance;

    beforeAll(async () => {
      const res = getTestServer();
      server = res.server;
      for (const route of Object.values(getRoutes(config, mockApi))) {
        // TODO: investigate type issue
        server.route(route as FastifyRoute<AnyEndpoint>);
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
        mockApi[method].mockResolvedValue({
          data: stateSerialized,
          meta: {version: ForkName.phase0, executionOptimistic: false, finalized: false},
        });

        const httpClient = new HttpClient({baseUrl});
        const client = getClient(config, httpClient);

        const res = await client[method]({stateId: "head"}, {responseWireFormat: WireFormat.ssz});

        expect(res.ok).toBe(true);

        if (res.ok) {
          expect(toHexString(res.ssz())).toBe(toHexString(stateSerialized));
        }
      });
    }
  });
});
