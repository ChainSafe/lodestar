import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {Api, ReqTypes} from "../../../src/builder/routes.js";
import {getClient} from "../../../src/builder/client.js";
import {getRoutes} from "../../../src/builder/server/index.js";
import {runGenericServerTest} from "../../utils/generic_server_test.js";
import {testData} from "./test_data.js";

describe("builder", () => {
  runGenericServerTest<Api, ReqTypes>(
    createChainForkConfig({
      ...defaultChainConfig,
      /* eslint-disable @typescript-eslint/naming-convention */
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
    }),
    getClient,
    getRoutes,
    testData
  );
});
