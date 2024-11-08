import {config} from "@lodestar/config/default";
import {describe} from "vitest";
import {getClient} from "../../../../src/beacon/client/proof.js";
import {Endpoints} from "../../../../src/beacon/routes/proof.js";
import {getRoutes} from "../../../../src/beacon/server/proof.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/proofs.js";

describe("beacon / proofs", () => {
  runGenericServerTest<Endpoints>(config, getClient, getRoutes, testData);
});
