import {config} from "@lodestar/config/default";
import {Api, ReqTypes} from "../../../../src/beacon/routes/lightclient.js";
import {getClient} from "../../../../src/beacon/client/lightclient.js";
import {getRoutes} from "../../../../src/beacon/server/lightclient.js";
import {runGenericServerTest} from "../../../utils/generic_server_test.js";
import {testData} from "../test_data/lightclient.js";

describe("beacon / lightclient", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);
});
