import {expect} from "chai";
import supertest from "supertest";
import {generateState} from "../../../../../utils/state";
import {ApiResponseBody, urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {getStateFork} from "../../../../../../src/api/rest/controllers/beacon/state/getStateFork";
import {SinonStubbedInstance} from "sinon";
import {BeaconStateApi} from "../../../../../../src/api/impl/beacon/state";
import {RestApi} from "../../../../../../src/api";

describe("rest - beacon - getStateFork", function () {
  let beaconStateStub: SinonStubbedInstance<BeaconStateApi>;
  let restApi: RestApi;

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconStateStub = restApi.server.api.beacon.state as SinonStubbedInstance<BeaconStateApi>;
  });

  it("should succeed", async function () {
    beaconStateStub.getFork.withArgs("head").resolves(generateState().fork);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFork.url.replace(":stateId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.current_version).to.not.be.undefined;
  });

  it("should not found state", async function () {
    beaconStateStub.getFork.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFork.url.replace(":stateId", "4")))
      .expect(404);
  });
});
