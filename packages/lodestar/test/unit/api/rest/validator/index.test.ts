import {config} from "@chainsafe/lodestar-config/minimal";
import {RestApi, ApiNamespace} from "../../../../../src/api";
import {testLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";

export const VALIDATOR_PREFIX = "/eth/v1/validator";

export let restApi: RestApi, api: StubbedApi;

beforeEach(async function () {
  api = new StubbedApi();
  restApi = await RestApi.init(
    {
      api: [ApiNamespace.VALIDATOR],
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
});
