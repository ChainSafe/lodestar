import {expect} from "chai";
import supertest from "supertest";
import {StateNotFound} from "../../../../../../src/api/impl/errors/api";
import {getStateValidators} from "../../../../../../src/api/rest/controllers/beacon";
import {generateValidator} from "../../../../../utils/validator";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";
import {phase0} from "@chainsafe/lodestar-types";

describe("rest - beacon - getStateValidators", function () {
  it("should success", async function () {
    api.beacon.state.getStateValidators.withArgs("head").resolves([
      {
        index: 1,
        balance: BigInt(3200000),
        status: phase0.ValidatorStatus.ACTIVE_ONGOING,
        validator: generateValidator(),
      },
    ]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidators.url.replace(":stateId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.equal(1);
  });

  it("should not found state", async function () {
    api.beacon.state.getStateValidators.withArgs("4").throws(new StateNotFound());
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidators.url.replace(":stateId", "4")))
      .expect(404);
    expect(api.beacon.state.getStateValidators.calledOnce).to.be.true;
  });
});
