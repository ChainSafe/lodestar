import {expect} from "chai";
import supertest from "supertest";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {SinonStubbedInstance} from "sinon";
import {DebugBeaconApi} from "../../../../../src/api/impl/debug/beacon";
import {getDebugChainHeads} from "../../../../../src/api/rest/debug/getDebugChainHeads";
import {RestApi} from "../../../../../src/api";
import {setupRestApiTestServer} from "../index.test";
import {ApiResponseBody} from "../utils";

describe("rest - debug - getDebugChainHeads", function () {
  let debugBeaconStub: SinonStubbedInstance<DebugBeaconApi>;
  let restApi: RestApi;

  before(async function () {
    restApi = await setupRestApiTestServer();
    debugBeaconStub = restApi.server.api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
  });

  it("should succeed", async function () {
    debugBeaconStub.getHeads.resolves([{slot: 100, root: ZERO_HASH}]);
    const response = await supertest(restApi.server.server)
      .get(getDebugChainHeads.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
  });
});
