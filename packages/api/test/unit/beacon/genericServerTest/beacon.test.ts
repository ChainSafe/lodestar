import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {Api, ReqTypes} from "../../../../src/beacon/routes/beacon/index.js";
import {getClient} from "../../../../src/beacon/client/beacon.js";
import {getRoutes} from "../../../../src/beacon/server/beacon.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/beacon.js";

describe("beacon / beacon", () => {
  runGenericServerTest<Api, ReqTypes>(
    // eslint-disable-next-line @typescript-eslint/naming-convention
    createChainForkConfig({...defaultChainConfig, ALTAIR_FORK_EPOCH: 1, BELLATRIX_FORK_EPOCH: 2}),
    getClient,
    getRoutes,
    testData
  );

  // TODO: Extra tests to implement maybe

  // getBlockHeaders
  // - fetch without filters
  // - parse slot param
  // - parse parentRoot param
  // - throw validation error on invalid slot
  // - throw validation error on invalid parentRoot - not hex
  // - throw validation error on invalid parentRoot - incorrect length
  // - throw validation error on invalid parentRoot - missing 0x prefix

  // getEpochCommittees
  // - succeed without filters
  // - succeed with filters
  // - throw validation error on string slot
  // - throw validation error on negative epoch

  // getStateValidator
  // - should get by root
  // - should get by index
  // - should not found state

  // getStateValidatorsBalances
  // - success with indices filter

  // All others:
  // - Failed to parse body
  // - should not found state
});
