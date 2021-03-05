import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/mainnet";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {StubbedApi} from "../../../../utils/stub/api";
import {testLogger} from "../../../../utils/logger";

export const BEACON_PREFIX = "/eth/v1/beacon";
export let restApi: RestApi, api: StubbedApi;

beforeEach(async function () {
  api = new StubbedApi(sinon);
  restApi = await RestApi.init(
    {
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0,
    },
    {
      config,
      logger: testLogger(),
      api,
    }
  );
});

afterEach(async function () {
  await restApi.close();
  sinon.restore();
});

describe("Test beacon rest api", function () {
  this.timeout(10000);
});
