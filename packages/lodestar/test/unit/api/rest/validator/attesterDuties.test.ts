import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {attesterDutiesController} from "../../../../../src/api/rest/controllers/validator/duties/attesterDuties";
import {silentLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "./index.test";

describe("rest - validator - attesterDuties", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.VALIDATOR],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        config,
        logger: silentLogger,
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    api.validator.getAttesterDuties.resolves([
      config.types.AttesterDuty.defaultValue(),
      config.types.AttesterDuty.defaultValue(),
    ]);
    const response = await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "0")))
      .send(["1", "4"])
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.be.instanceOf(Array);
    expect(response.body.data).to.have.length(2);
    expect(api.validator.getAttesterDuties.withArgs(0, [1, 4]).calledOnce).to.be.true;
  });

  it("invalid epoch", async function () {
    api.validator.getAttesterDuties.resolves([
      config.types.AttesterDuty.defaultValue(),
      config.types.AttesterDuty.defaultValue(),
    ]);
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "a")))
      .send(["1", "4"])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("no validator indices", async function () {
    api.validator.getAttesterDuties.resolves([
      config.types.AttesterDuty.defaultValue(),
      config.types.AttesterDuty.defaultValue(),
    ]);
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "1")))
      .send([])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("invalid validator index", async function () {
    api.validator.getAttesterDuties.resolves([
      config.types.AttesterDuty.defaultValue(),
      config.types.AttesterDuty.defaultValue(),
    ]);
    await supertest(restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "1")))
      .send([1, "a"])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
