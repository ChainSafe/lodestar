import {phase0} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import supertest from "supertest";
import {setupRestApiTestServer} from "../index.test";
import {getForkSchedule} from "../../../../../src/api/rest/config/getForkSchedule";
import {SinonStubbedInstance} from "sinon";
import {ConfigApi} from "../../../../../src/api/impl/config";
import {ApiResponseBody} from "../utils";

describe("rest - config - getForkSchedule", function () {
  it("ready", async function () {
    const restApi = await setupRestApiTestServer();
    const configStub = restApi.server.api.config as SinonStubbedInstance<ConfigApi>;
    const expectedData: phase0.Fork[] = [];
    configStub.getForkSchedule.resolves(expectedData);
    const response = await supertest(restApi.server.server).get(getForkSchedule.url).expect(200);
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data).to.deep.equal(expectedData);
  });
});
