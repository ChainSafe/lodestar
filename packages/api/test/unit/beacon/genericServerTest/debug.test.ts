import {describe, it, expect, MockInstance} from "vitest";
import {toHexString} from "@chainsafe/ssz";
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

describe.sequential(
  "beacon / debug",
  () => {
    runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);

    // Get state by SSZ

    describe("getState() in SSZ format", () => {
      const {baseUrl, server} = getTestServer();
      const mockApi = getMockApi<Api>(routesData);
      for (const route of Object.values(getRoutes(config, mockApi))) {
        registerRoute(server, route);
      }

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
  },
  // Extend timeout since states are very big
  {timeout: 30 * 1000}
);
