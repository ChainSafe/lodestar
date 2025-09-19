import {describe} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getClient} from "../../../../src/beacon/client/proof.js";
import {Endpoints} from "../../../../src/beacon/routes/proof.js";
import {getRoutes} from "../../../../src/beacon/server/proof.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/proofs.js";

describe("beacon / proofs", () => {
  runGenericServerTest<Endpoints>(
    createChainForkConfig({...defaultChainConfig, ELECTRA_FORK_EPOCH: 0}),
    getClient,
    getRoutes,
    testData
  );
});
