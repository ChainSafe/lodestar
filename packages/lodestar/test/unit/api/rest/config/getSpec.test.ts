import {config} from "@chainsafe/lodestar-config/minimal";
import {BeaconParams} from "@chainsafe/lodestar-params";
import {expect} from "chai";
import supertest from "supertest";
import {setupRestApiTestServer} from "../index.test";
import {getSpec} from "../../../../../src/api/rest/config/getSpec";
import {SinonStubbedInstance} from "sinon";
import {ConfigApi} from "../../../../../src/api/impl/config";
import {ApiResponseBody} from "../utils";

describe("rest - config - getSpec", function () {
  it("ready", async function () {
    const restApi = await setupRestApiTestServer();
    const configStub = restApi.server.api.config as SinonStubbedInstance<ConfigApi>;
    configStub.getSpec.resolves(config.params);
    const response = await supertest(restApi.server.server).get(getSpec.url).expect(200);
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data).to.deep.equal(BeaconParams.toJson(config.params));
  });
});
