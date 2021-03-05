import {phase0} from "@chainsafe/lodestar-types";
import {urlJoin} from "@chainsafe/lodestar-validator/src/util";
import {expect} from "chai";
import supertest from "supertest";
import {CONFIG_PREFIX, api, restApi} from "./index.test";
import {getForkSchedule} from "../../../../../src/api/rest/controllers/config";

describe("rest - config - getForkSchedule", function () {
  it("ready", async function () {
    const expectedData: phase0.Fork[] = [];
    api.config.getForkSchedule.resolves(expectedData);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(CONFIG_PREFIX, getForkSchedule.url))
      .expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.deep.equal(expectedData);
  });
});
