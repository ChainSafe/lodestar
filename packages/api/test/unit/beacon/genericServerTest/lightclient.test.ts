import {config} from "@lodestar/config/default";
import {describe} from "vitest";
import {getClient} from "../../../../src/beacon/client/lightclient.js";
import {Endpoints} from "../../../../src/beacon/routes/lightclient.js";
import {getRoutes} from "../../../../src/beacon/server/lightclient.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/lightclient.js";

describe("beacon / lightclient", () => {
  runGenericServerTest<Endpoints>(config, getClient, getRoutes, testData);
});
