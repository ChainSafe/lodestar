import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {attesterDutiesController} from "../../../../../src/api/rest/controllers/validator/duties/attesterDuties";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "../index.test";

describe("rest - validator - attesterDuties", function () {
  it("should succeed", async function () {
    this.test?.ctx?.api.validator.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "0")))
      .send(["1", "4"])
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.be.instanceOf(Array);
    expect(response.body.data).to.have.length(2);
    expect(this.test?.ctx?.api.validator.getAttesterDuties.withArgs(0, [1, 4]).calledOnce).to.be.true;
  });

  it("invalid epoch", async function () {
    this.test?.ctx?.api.validator.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "a")))
      .send(["1", "4"])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("no validator indices", async function () {
    this.test?.ctx?.api.validator.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "1")))
      .send([])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("invalid validator index", async function () {
    this.test?.ctx?.api.validator.getAttesterDuties.resolves([
      config.types.phase0.AttesterDuty.defaultValue(),
      config.types.phase0.AttesterDuty.defaultValue(),
    ]);
    await supertest(this.test?.ctx?.restApi.server.server)
      .post(urlJoin(VALIDATOR_PREFIX, attesterDutiesController.url.replace(":epoch", "1")))
      .send([1, "a"])
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
