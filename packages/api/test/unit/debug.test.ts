import {ForkName} from "@chainsafe/lodestar-config";
import {fetch} from "cross-fetch";
import {config} from "@chainsafe/lodestar-config/minimal";
import {Api, ReqTypes, routesData} from "../../src/routes/debug";
import {getClient} from "../../src/client/debug";
import {getRoutes} from "../../src/server/debug";
import {runGenericServerTest} from "../utils/genericServerTest";
import {getMockApi, getTestServer} from "../utils/utils";
import {registerRoutesGroup} from "../../src/server";
import {expect} from "chai";

const root = Buffer.alloc(32, 1);

describe("debug", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    getHeads: {
      args: [],
      res: {data: [{slot: 1, root}]},
    },
    getState: {
      args: ["head"],
      res: {data: config.types.phase0.BeaconState.defaultValue()},
    },
    getStateV2: {
      args: ["head"],
      res: {data: config.types.altair.BeaconState.defaultValue(), version: ForkName.altair},
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

  describe("get SSZ response", () => {
    const {baseUrl, server} = getTestServer();
    const mockApi = getMockApi<Api>(routesData);
    const routes = getRoutes(config, mockApi);
    registerRoutesGroup(server, routes);

    it("getState", async () => {
      const state = config.types.phase0.BeaconState.defaultValue();
      mockApi.getState.resolves({data: state});

      const url = baseUrl + routesData.getState.url;
      const res = await fetch(url, {
        method: routesData.getState.method,
        headers: {accept: "application/octet-stream"},
      });
      if (!res.ok) throw Error(res.statusText);
      const arrayBuffer = await res.arrayBuffer();

      expect(res.headers.get("Content-Type")).to.equal("application/octet-stream", "Wrong Content-Type header value");

      const stateRes = config.types.phase0.BeaconState.deserialize(new Uint8Array(arrayBuffer));
      expect(config.types.phase0.BeaconState.toJson(state)).to.deep.equal(
        config.types.phase0.BeaconState.toJson(stateRes),
        "returned state value is not equal"
      );
    });
  });
});
