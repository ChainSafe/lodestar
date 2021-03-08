import {expect} from "chai";
import supertest from "supertest";
import {produceAttestationData} from "../../../../../src/api/rest/controllers/validator/produceAttestationData";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX, api, restApi} from "./index.test";

describe("rest - validator - produceAttestationData", function () {
  it("should succeed", async function () {
    api.validator.produceAttestationData.resolves(generateEmptyAttestation().data);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceAttestationData.url))
      .query({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        committee_index: 1,
        slot: 0,
      })
      .expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.undefined;
    expect(api.validator.produceAttestationData.withArgs(1, 0).calledOnce).to.be.true;
  });

  it("missing param", async function () {
    api.validator.getAggregatedAttestation.resolves();
    await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceAttestationData.url))
      .query({
        slot: 0,
      })
      .expect(400);
    expect(api.validator.produceAttestationData.notCalled).to.be.true;
  });
});
