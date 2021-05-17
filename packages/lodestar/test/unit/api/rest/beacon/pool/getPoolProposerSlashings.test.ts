import {expect} from "chai";
import supertest from "supertest";
import {getPoolProposerSlashings} from "../../../../../../src/api/rest/beacon/pool/getPoolProposerSlashings";
import {generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {ApiResponseBody} from "../../utils";
import {setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";

describe("rest - beacon - getPoolProposerSlashings", function () {
  it("should succeed", async function () {
    const restApi = await setupRestApiTestServer();
    const beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
    beaconPoolStub.getProposerSlashings.resolves([generateEmptyProposerSlashing()]);
    const response = await supertest(restApi.server.server)
      .get(getPoolProposerSlashings.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data.length).to.be.equal(1);
  });
});
