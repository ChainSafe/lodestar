import {expect} from "chai";
import supertest from "supertest";
import {getStateFinalityCheckpoints} from "../../../../../../src/api/rest/controllers/beacon/state";
import {generateState} from "../../../../../utils/state";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";

describe("rest - beacon - getStateFinalityCheckpoints", function () {
  it("should succeed", async function () {
    api.beacon.state.getState.withArgs("head").resolves(generateState());
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFinalityCheckpoints.url.replace(":stateId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.finalized).to.not.be.undefined;
  });

  it("should not found state", async function () {
    api.beacon.state.getState.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFinalityCheckpoints.url.replace(":stateId", "4")))
      .expect(404);
  });
});
