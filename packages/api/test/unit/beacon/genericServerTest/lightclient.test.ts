import {describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {getClient} from "../../../../src/beacon/client/lightclient.js";
import {Endpoints} from "../../../../src/beacon/routes/lightclient.js";
import {getRoutes} from "../../../../src/beacon/server/lightclient.js";
import {HttpClient} from "../../../../src/utils/client/index.js";
import {WireFormat} from "../../../../src/utils/wireFormat.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {getMockApi, getTestServer} from "../../../utils/utils.js";
import {testData} from "../testData/lightclient.js";

describe("beacon / lightclient", () => {
  runGenericServerTest<Endpoints>(
    createChainForkConfig({...defaultChainConfig, ELECTRA_FORK_EPOCH: 0}),
    getClient,
    getRoutes,
    testData
  );

  it.each(["ephemery", "custom"] as const)(
    "decodes runtime-root SSZ updates with a chain-only %s client",
    async (network) => {
      const chainConfig = createChainForkConfig({...networksChainConfig.ephemery, CONFIG_NAME: network});
      const serverConfig = createBeaconConfig(chainConfig, new Uint8Array(32).fill(7));
      const testCase = testData.getLightClientUpdatesByRange;
      const mockApi = getMockApi<Endpoints>(testData);
      mockApi.getLightClientUpdatesByRange.mockResolvedValue(testCase.res);
      const {server, start} = getTestServer();

      try {
        server.route(getRoutes(serverConfig, mockApi).getLightClientUpdatesByRange);
        const client = getClient(chainConfig, new HttpClient({baseUrl: await start()}));
        const response = await client.getLightClientUpdatesByRange(testCase.args, {responseWireFormat: WireFormat.ssz});

        expect(response.wireFormat()).toBe(WireFormat.ssz);
        expect(response.meta()).toEqual(testCase.res.meta);
        expect(response.value()).toEqual(testCase.res.data);
      } finally {
        await server.close();
      }
    }
  );
});
