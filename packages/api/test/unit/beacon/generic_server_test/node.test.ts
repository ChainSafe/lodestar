import {config} from "@lodestar/config/default";
import {Api, ReqTypes} from "../../../../src/beacon/routes/node.js";
import {getClient} from "../../../../src/beacon/client/node.js";
import {getRoutes} from "../../../../src/beacon/server/node.js";
import {runGenericServerTest} from "../../../utils/generic_server_test.js";
import {testData} from "../test_data/node.js";

describe("beacon / node", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);
});
