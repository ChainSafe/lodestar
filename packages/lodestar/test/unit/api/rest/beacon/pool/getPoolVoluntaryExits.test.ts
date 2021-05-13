import {expect} from "chai";
import supertest from "supertest";
import {getPoolVoluntaryExits} from "../../../../../../src/api/rest/beacon/pool/getPoolVoluntaryExits";
import {generateEmptySignedVoluntaryExit} from "../../../../../utils/attestation";
import {ApiResponseBody} from "../../utils";
import {setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - getPoolVoluntaryExits", function () {
  it("should succeed", async function () {
    const restApi = await setupRestApiTestServer();
    const beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
    beaconPoolStub.getVoluntaryExits.withArgs().resolves([generateEmptySignedVoluntaryExit()]);
    const response = await supertest(restApi.server.server)
      .get(getPoolVoluntaryExits.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data.length).to.be.equal(1);
  });
});
