import {expect} from "chai";
import supertest from "supertest";
import {generateState} from "../../../../../utils/state";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";
import {getStateFork} from "../../../../../../src/api/rest/controllers/beacon/state/getStateFork";

describe("rest - beacon - getStateFork", function () {
  it("should succeed", async function () {
    api.beacon.state.getFork.withArgs("head").resolves(generateState().fork);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFork.url.replace(":stateId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.current_version).to.not.be.undefined;
  });

  it("should not found state", async function () {
    api.beacon.state.getFork.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFork.url.replace(":stateId", "4")))
      .expect(404);
  });
});
