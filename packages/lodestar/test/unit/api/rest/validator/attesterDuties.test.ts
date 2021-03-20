import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {attesterDutiesController} from "../../../../../src/api/rest/controllers/validator/duties/attesterDuties";
import {ApiResponseBody, urlJoin} from "../utils";
import {setupRestApiTestServer, VALIDATOR_PREFIX} from "../index.test";
import {SinonStubbedInstance} from "sinon";
import {RestApi, ValidatorApi} from "../../../../../src/api";

describe("rest - validator - attesterDuties", function () {
  let restApi: RestApi;
  let validatorStub: SinonStubbedInstance<ValidatorApi>;

  before(async function () {
    restApi = await setupRestApiTestServer();
    validatorStub = restApi.server.api.validator as SinonStubbedInstance<ValidatorApi>;
  });

  it("should succeed", async function () {
    validatorStub.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    const response = await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "0")))
      .send(["1", "4"])
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.be.instanceOf(Array);
    expect((response.body as ApiResponseBody).data).to.have.length(2);
    expect(validatorStub.getAttesterDuties.withArgs(0, [1, 4]).calledOnce).to.be.true;
  });

  it("invalid epoch", async function () {
    validatorStub.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "a")))
      .send(["1", "4"])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("no validator indices", async function () {
    validatorStub.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "1")))
      .send([])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("invalid validator index", async function () {
    validatorStub.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "1")))
      .send([1, "a"])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
