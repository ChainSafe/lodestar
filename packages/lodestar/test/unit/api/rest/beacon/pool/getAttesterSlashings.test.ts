import {expect} from "chai";
import supertest from "supertest";
import {getAttesterSlashings} from "../../../../../../src/api/rest/controllers/beacon/pool/getAttesterSlashings";
import {generateEmptyAttesterSlashing} from "../../../../../utils/slashings";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";

describe("rest - beacon - getAttesterSlashings", function () {
  it("should succeed", async function () {
    api.beacon.pool.getAttesterSlashings.resolves([generateEmptyAttesterSlashing()]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getAttesterSlashings.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });
});
