import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {getAggregatedAttestation} from "../../../../../src/api/rest/validator/getAggregatedAttestation";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {ApiResponseBody} from "../utils";
import {setupRestApiTestServer} from "../index.test";
import {SinonStubbedInstance} from "sinon";
import {RestApi, ValidatorApi} from "../../../../../src/api";

describe("rest - validator - getAggregatedAttestation", function () {
  let restApi: RestApi;
  let validatorStub: SinonStubbedInstance<ValidatorApi>;

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    validatorStub = restApi.server.api.validator as SinonStubbedInstance<ValidatorApi>;
  });

  it("should succeed", async function () {
    const root = config.types.Root.defaultValue();
    validatorStub.getAggregatedAttestation.resolves(generateEmptyAttestation());
    const response = await supertest(restApi.server.server)
      .get(getAggregatedAttestation.url)
      .query({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        attestation_data_root: toHexString(root),
        slot: 0,
      })
      .expect(200);
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect(validatorStub.getAggregatedAttestation.withArgs(root, 0).calledOnce).to.be.true;
  });

  it("missing param", async function () {
    validatorStub.getAggregatedAttestation.resolves();
    await supertest(restApi.server.server)
      .get(getAggregatedAttestation.url)
      .query({
        slot: 0,
      })
      .expect(400);
    expect(validatorStub.getAggregatedAttestation.notCalled).to.be.true;
  });
});
