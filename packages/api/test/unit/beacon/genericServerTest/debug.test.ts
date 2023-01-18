import {expect} from "chai";
import {ssz} from "@lodestar/types";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {Api, ReqTypes, routesData} from "../../../../src/beacon/routes/debug.js";
import {getClient} from "../../../../src/beacon/client/debug.js";
import {getRoutes} from "../../../../src/beacon/server/debug.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";
import {registerRoute} from "../../../../src/utils/server/registerRoute.js";
import {HttpClient} from "../../../../src/utils/client/httpClient.js";
import {testData} from "../testData/debug.js";

describe("beacon / debug", function () {
  // Extend timeout since states are very big
  this.timeout(30 * 1000);

  describe("Run generic server test", () => {
    runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);
  });

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
        mockApi[method].resolves(stateSerialized);

        const httpClient = new HttpClient({baseUrl});
        const client = getClient(config, httpClient);

        const res = await client[method]("head", "ssz");

        expect(res.ok).to.be.true;

        if (res.ok) {
          expect(toHexString(res.response)).to.equal(toHexString(stateSerialized), "returned state value is not equal");
        }
      });
    }
  });
});
