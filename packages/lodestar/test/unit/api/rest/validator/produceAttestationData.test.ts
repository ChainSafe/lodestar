import {expect} from "chai";
import supertest from "supertest";
import {produceAttestationData} from "../../../../../src/api/rest/controllers/validator/produceAttestationData";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "../index.test";
import {SinonStubbedInstance} from "sinon";
import {RestApi, ValidatorApi} from "../../../../../src/api";

describe("rest - validator - produceAttestationData", function () {
  let restApi: RestApi;
  let validatorStub: SinonStubbedInstance<ValidatorApi>;

  beforeEach(function () {
    validatorStub = this.test?.ctx?.validatorStub;
    restApi = this.test?.ctx?.restApi;
  });

  it("should succeed", async function () {
    validatorStub.produceAttestationData.resolves(generateEmptyAttestation().data);
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
    expect(validatorStub.produceAttestationData.withArgs(1, 0).calledOnce).to.be.true;
  });

  it("missing param", async function () {
    validatorStub.getAggregatedAttestation.resolves();
    await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceAttestationData.url))
      .query({
        slot: 0,
      })
      .expect(400);
    expect(validatorStub.produceAttestationData.notCalled).to.be.true;
  });
});
