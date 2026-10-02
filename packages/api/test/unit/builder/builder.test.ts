import {describe} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getClient} from "../../../src/builder/client.js";
import {Endpoints} from "../../../src/builder/routes.js";
import {getRoutes} from "../../../src/builder/server/index.js";
import {runGenericServerTest} from "../../utils/genericServerTest.js";
import {testData} from "./testData.js";

describe("builder", () => {
  runGenericServerTest<Endpoints>(
    // Gloas at a later epoch so pre-gloas test data (slot 0) and gloas test data (slot 32000) both resolve
    createChainForkConfig({
      ...defaultChainConfig,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 1000,
      GLOAS_FORK_EPOCH: 1000,
    }),
    getClient,
    getRoutes,
    testData
  );
});
