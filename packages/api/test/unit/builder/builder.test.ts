import {describe} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getClient} from "../../../src/builder/client.js";
import {Endpoints} from "../../../src/builder/routes.js";
import {getRoutes} from "../../../src/builder/server/index.js";
import {runGenericServerTest} from "../../utils/genericServerTest.js";
import {testData} from "./testData.js";

describe("builder", () => {
  runGenericServerTest<Endpoints>(
    createChainForkConfig({
      ...defaultChainConfig,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 1,
      DENEB_FORK_EPOCH: 1,
      ELECTRA_FORK_EPOCH: 1,
      FULU_FORK_EPOCH: 1,
      GLOAS_FORK_EPOCH: Infinity,
    }),
    getClient,
    getRoutes,
    testData
  );
});
