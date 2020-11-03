import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {getStateFinalityCheckpoints} from "../../../../../../src/api/rest/controllers/beacon/state";
import {silentLogger} from "../../../../../utils/logger";
import {generateState} from "../../../../../utils/state";
import {StubbedApi} from "../../../../../utils/stub/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";

describe("rest - beacon - getStateFinalityCheckpoints", function () {
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
    api.beacon.state.getState.withArgs("head").resolves(generateState());
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFinalityCheckpoints.url.replace(":stateId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.finalized).to.not.be.undefined;
  });

  it("should not found state", async function () {
    api.beacon.state.getState.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateFinalityCheckpoints.url.replace(":stateId", "4")))
      .expect(404);
  });
});
