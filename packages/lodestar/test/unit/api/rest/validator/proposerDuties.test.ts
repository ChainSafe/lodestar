import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {proposerDutiesController} from "../../../../../src/api/rest/controllers/validator";
import {silentLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "./index.test";

describe("rest - validator - proposerDuties", function () {
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
    api.validator.getProposerDuties.resolves([
      config.types.ProposerDuty.defaultValue(),
      config.types.ProposerDuty.defaultValue(),
    ]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, proposerDutiesController.url.replace(":epoch", "1")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.be.instanceOf(Array);
    expect(response.body.data).to.have.length(2);
    expect(api.validator.getProposerDuties.withArgs(1).calledOnce).to.be.true;
  });

  it("invalid epoch", async function () {
    await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, proposerDutiesController.url.replace(":epoch", "a")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
