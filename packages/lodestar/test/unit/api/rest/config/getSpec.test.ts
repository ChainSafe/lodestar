import {config} from "@chainsafe/lodestar-config/minimal";
import {BeaconParams} from "@chainsafe/lodestar-params";
import {urlJoin} from "@chainsafe/lodestar-validator/src/util";
import {expect} from "chai";
import supertest from "supertest";
import {CONFIG_PREFIX} from ".";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getSpec} from "../../../../../src/api/rest/controllers/config";
import {testLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";

describe("rest - config - getSpec", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.CONFIG],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        config,
        logger: testLogger(),
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("ready", async function () {
    api.config.getSpec.resolves(config.params);
    const response = await supertest(restApi.server.server).get(urlJoin(CONFIG_PREFIX, getSpec.url)).expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.deep.equal(BeaconParams.toJson(config.params));
  });
});
