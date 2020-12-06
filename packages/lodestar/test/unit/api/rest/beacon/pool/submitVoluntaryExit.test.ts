import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {submitVoluntaryExit} from "../../../../../../src/api/rest/controllers/beacon/pool";
import {generateEmptySignedVoluntaryExit} from "../../../../../utils/attestation";
import {silentLogger} from "../../../../../utils/logger";
import {StubbedApi} from "../../../../../utils/stub/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";

describe("rest - beacon - submitVoluntaryExit", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.BEACON],
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
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitVoluntaryExit.url))
      .send(config.types.SignedVoluntaryExit.toJson(voluntaryExit, {case: "snake"}) as Record<string, unknown>)
      .expect(200);
    expect(api.beacon.pool.submitVoluntaryExit.calledOnce).to.be.true;
  });

  it("should fail to parse body", async function () {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, submitVoluntaryExit.url))
      .send(config.types.SignedVoluntaryExit.toJson(voluntaryExit, {case: "camel"}) as Record<string, unknown>)
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(api.beacon.pool.submitVoluntaryExit.notCalled).to.be.true;
  });
});
