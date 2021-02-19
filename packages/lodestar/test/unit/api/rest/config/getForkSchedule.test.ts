import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-types";
import {urlJoin} from "@chainsafe/lodestar-validator/src/util";
import {expect} from "chai";
import supertest from "supertest";
import {CONFIG_PREFIX} from ".";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getForkSchedule} from "../../../../../src/api/rest/controllers/config";
import {silentLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";

describe("rest - config - getForkSchedule", function () {
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
        logger: silentLogger,
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

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
