import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {describe} from "vitest";
import {getClient} from "../../../../src/beacon/client/lightclient.js";
import {Endpoints} from "../../../../src/beacon/routes/lightclient.js";
import {getRoutes} from "../../../../src/beacon/server/lightclient.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/lightclient.js";

describe("beacon / lightclient", () => {
  runGenericServerTest<Endpoints>(
    createChainForkConfig({...defaultChainConfig, ELECTRA_FORK_EPOCH: 0}),
    getClient,
    getRoutes,
    testData
  );
});
