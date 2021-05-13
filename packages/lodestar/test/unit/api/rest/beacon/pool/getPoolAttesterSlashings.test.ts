import {expect} from "chai";
import supertest from "supertest";
import {getPoolAttesterSlashings} from "../../../../../../src/api/rest/beacon/pool/getPoolAttesterSlashings";
import {generateEmptyAttesterSlashing} from "../../../../../utils/slashings";
import {ApiResponseBody} from "../../utils";
import {setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - getPoolAttesterSlashings", function () {
  it("should succeed", async function () {
    const restApi = await setupRestApiTestServer();
    const beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
    beaconPoolStub.getAttesterSlashings.resolves([generateEmptyAttesterSlashing()]);
    const response = await supertest(restApi.server.server)
      .get(getPoolAttesterSlashings.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data.length).to.be.equal(1);
  });
});
