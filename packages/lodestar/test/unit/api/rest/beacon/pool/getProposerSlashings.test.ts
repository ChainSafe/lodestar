import {expect} from "chai";
import supertest from "supertest";
import {getProposerSlashings} from "../../../../../../src/api/rest/controllers/beacon/pool/getProposerSlashings";
import {generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../../index.test";

describe("rest - beacon - getProposerSlashings", function () {
  it("should succeed", async function () {
    this.test?.ctx?.beaconPoolStub.getProposerSlashings.resolves([generateEmptyProposerSlashing()]);
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getProposerSlashings.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });
});
