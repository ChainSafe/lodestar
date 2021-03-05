import {expect} from "chai";
import supertest from "supertest";
import {getPoolAttestations} from "../../../../../../src/api/rest/controllers/beacon/pool";
import {generateAttestation} from "../../../../../utils/attestation";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";

describe("rest - beacon - getPoolAttestations", function () {
  it("should succeed", async function () {
    api.beacon.pool.getAttestations.withArgs({committeeIndex: 1, slot: 1}).resolves([generateAttestation()]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getPoolAttestations.url))
      // eslint-disable-next-line @typescript-eslint/naming-convention
      .query({slot: "1", committee_index: "1"})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });
});
