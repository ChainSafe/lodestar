import {createIChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {Api, ReqTypes} from "../../../src/builder/routes.js";
import {getClient} from "../../../src/builder/client.js";
import {getRoutes} from "../../../src/builder/server/index.js";
import {runGenericServerTest} from "../../utils/genericServerTest.js";
import {testData} from "./testData.js";

describe("builder", () => {
  runGenericServerTest<Api, ReqTypes>(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    createIChainForkConfig({...defaultChainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0}),
    getClient,
    getRoutes,
    testData
  );
});
