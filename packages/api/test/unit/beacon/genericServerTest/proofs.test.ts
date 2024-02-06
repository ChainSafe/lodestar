import {describe} from "vitest";
import {config} from "@lodestar/config/default";
import {Api, ReqTypes} from "../../../../src/beacon/routes/proof.js";
import {getClient} from "../../../../src/beacon/client/proof.js";
import {getRoutes} from "../../../../src/beacon/server/proof.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/proofs.js";

describe.sequential("beacon / proofs", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);
});
