import {expect} from "chai";
import supertest from "supertest";
import {StateNotFound} from "../../../../../../src/api/impl/errors/api";
import {getStateValidators} from "../../../../../../src/api/rest/controllers/beacon";
import {generateValidator} from "../../../../../utils/validator";
import {ApiResponseBody, urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {phase0} from "@chainsafe/lodestar-types";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconStateApi} from "../../../../../../src/api/impl/beacon/state";

describe("rest - beacon - getStateValidators", function () {
  let beaconStateStub: SinonStubbedInstance<BeaconStateApi>;
  let restApi: RestApi;

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconStateStub = restApi.server.api.beacon.state as SinonStubbedInstance<BeaconStateApi>;
  });

  it("should success", async function () {
    beaconStateStub.getStateValidators.withArgs("head").resolves([
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
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data.length).to.equal(1);
  });

  it("should not found state", async function () {
    beaconStateStub.getStateValidators.withArgs("4").throws(new StateNotFound());
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidators.url.replace(":stateId", "4")))
      .expect(404);
    expect(beaconStateStub.getStateValidators.calledOnce).to.be.true;
  });
});
