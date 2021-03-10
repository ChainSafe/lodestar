import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {proposerDutiesController} from "../../../../../src/api/rest/controllers/validator";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "../index.test";
import {RestApi, ValidatorApi} from "../../../../../src/api";
import {SinonStubbedInstance} from "sinon";

describe("rest - validator - proposerDuties", function () {
  let restApi: RestApi;
  let validatorStub: SinonStubbedInstance<ValidatorApi>;

  beforeEach(function () {
    validatorStub = this.test?.ctx?.validatorStub;
    restApi = this.test?.ctx?.restApi;
  });

  it("should succeed", async function () {
    validatorStub.getProposerDuties.resolves([
      config.types.phase0.ProposerDuty.defaultValue(),
      config.types.phase0.ProposerDuty.defaultValue(),
    ]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, proposerDutiesController.url.replace(":epoch", "1")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.be.instanceOf(Array);
    expect(response.body.data).to.have.length(2);
    expect(validatorStub.getProposerDuties.withArgs(1).calledOnce).to.be.true;
  });

  it("invalid epoch", async function () {
    await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, proposerDutiesController.url.replace(":epoch", "a")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
