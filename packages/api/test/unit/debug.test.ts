import {ForkName} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {Api, ReqTypes, routesData} from "../../src/routes/debug";
import {getClient} from "../../src/client/debug";
import {getRoutes} from "../../src/server/debug";
import {runGenericServerTest} from "../utils/genericServerTest";
import {getMockApi, getTestServer} from "../utils/utils";
import {registerRoutesGroup} from "../../src/server";
import {expect} from "chai";
import {HttpClient} from "../../src";

describe("debug", function () {
  // Extend timeout since states are very big
  this.timeout(30 * 1000);
  const root = Buffer.alloc(32, 1);

  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    getHeads: {
      args: [],
      res: {data: [{slot: 1, root: toHexString(root)}]},
    },
    getState: {
      args: ["head", "json"],
      res: {data: ssz.phase0.BeaconState.defaultValue()},
    },
    getStateV2: {
      args: ["head", "json"],
      res: {data: ssz.altair.BeaconState.defaultValue(), version: ForkName.altair},
    },
    connectToPeer: {
      args: ["peerId", ["multiaddr1", "multiaddr2"]],
      res: undefined,
    },
    disconnectPeer: {
      args: ["peerId"],
      res: undefined,
    },
  });

  // Get state by SSZ

  describe("getState() in SSZ format", () => {
    const {baseUrl, server} = getTestServer();
    const mockApi = getMockApi<Api>(routesData);
    const routes = getRoutes(config, mockApi);
    registerRoutesGroup(server, routes);

    for (const method of ["getState" as const, "getStateV2" as const]) {
      it(method, async () => {
        const state = ssz.phase0.BeaconState.defaultValue();
        const stateSerialized = ssz.phase0.BeaconState.serialize(state);
        mockApi[method].resolves(stateSerialized);

        const httpClient = new HttpClient({baseUrl});
        const client = getClient(config, httpClient);

        const res = await client[method]("head", "ssz");

        expect(toHexString(res)).to.equal(toHexString(stateSerialized), "returned state value is not equal");
      });
    }
  });
});
