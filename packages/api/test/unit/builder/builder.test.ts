import {config} from "@chainsafe/lodestar-config/default";
import {Api, ReqTypes} from "../../../src/builder/routes.js";
import {getClient} from "../../../src/builder/client.js";
import {getRoutes} from "../../../src/builder/server/index.js";
import {runGenericServerTest} from "../../utils/genericServerTest.js";

describe("builder", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    checkStatus: {
      args: [],
      res: undefined,
    },
  });
});
