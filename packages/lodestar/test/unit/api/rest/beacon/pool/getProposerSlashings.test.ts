import {expect} from "chai";
import supertest from "supertest";
import {getProposerSlashings} from "../../../../../../src/api/rest/controllers/beacon/pool/getProposerSlashings";
import {generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {BeaconPoolApi} from "../../../../../../lib/api/impl/beacon/pool";

describe("rest - beacon - getProposerSlashings", function () {
  it("should succeed", async function () {
    const restApi = await setupRestApiTestServer();
    const beaconPoolStub = restApi.server.api.beacon.pool as SinonStubbedInstance<BeaconPoolApi>;
    beaconPoolStub.getProposerSlashings.resolves([generateEmptyProposerSlashing()]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getProposerSlashings.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });
});
