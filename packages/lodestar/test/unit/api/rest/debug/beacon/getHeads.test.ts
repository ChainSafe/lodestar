import {expect} from "chai";
import supertest from "supertest";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {SinonStubbedInstance} from "sinon";
import {DebugBeaconApi} from "../../../../../../src/api/impl/debug/beacon";
import { api, restApi } from "./index.test";

describe("rest - debug - beacon - getHeads", function () {
  it("should succeed", async function () {
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    debugBeaconStub.getHeads.resolves([{slot: 100, root: ZERO_HASH}]);
    const response = await supertest(restApi.server.server)
      .get("/eth/v1/debug/beacon/heads")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
  });

  it("should not found heads", async function () {
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    debugBeaconStub.getHeads.resolves(null);
    await supertest(restApi.server.server).get("/eth/v1/debug/beacon/heads").expect(404);
  });
});
