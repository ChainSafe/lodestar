import {config} from "@lodestar/config/default";
import {Api, ReqTypes} from "../../../../src/beacon/routes/proofs.js";
import {getClient} from "../../../../src/beacon/client/proofs.js";
import {getRoutes} from "../../../../src/beacon/server/proofs.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/proofs.js";

describe("beacon / proofs", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);
});
