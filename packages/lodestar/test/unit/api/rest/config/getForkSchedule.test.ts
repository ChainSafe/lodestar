import {phase0} from "@chainsafe/lodestar-types";
import {urlJoin} from "@chainsafe/lodestar-validator/src/util";
import {expect} from "chai";
import supertest from "supertest";
import {CONFIG_PREFIX} from "../index.test";
import {getForkSchedule} from "../../../../../src/api/rest/controllers/config";

describe("rest - config - getForkSchedule", function () {
  it("ready", async function () {
    const expectedData: phase0.Fork[] = [];
    this.test?.ctx?.configStub.getForkSchedule.resolves(expectedData);
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(CONFIG_PREFIX, getForkSchedule.url))
      .expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.deep.equal(expectedData);
  });
});
