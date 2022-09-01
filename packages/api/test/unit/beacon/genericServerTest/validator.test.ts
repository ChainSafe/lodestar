import {config} from "@lodestar/config/default";
import {Api, ReqTypes} from "../../../../src/beacon/routes/validator.js";
import {getClient} from "../../../../src/beacon/client/validator.js";
import {getRoutes} from "../../../../src/beacon/server/validator.js";
import {runGenericServerTest} from "../../../utils/genericServerTest.js";
import {testData} from "../testData/validator.js";

describe("beacon / validator", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, testData);

  // TODO: Extra tests to implement maybe

  // getAttesterDuties
  // - throw validation error on invalid epoch "a"
  // - throw validation error on no validator indices
  // - throw validation error on invalid validator index "a"

  // getProposerDuties
  // - throw validation error on invalid epoch "a"

  // prepareBeaconCommitteeSubnet
  // - throw validation error on missing param

  // produceAttestationData
  // - throw validation error on missing param

  // produceBlock
  // - throw validation error on missing randao reveal
  // - throw validation error on invalid slot
});
