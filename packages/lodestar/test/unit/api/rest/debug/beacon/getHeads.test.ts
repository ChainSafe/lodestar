import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/minimal";

import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {StubbedApi} from "../../../../../utils/stub/api";
import {silentLogger} from "../../../../../utils/logger";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {SinonStubbedInstance} from "sinon";
import {DebugBeaconApi} from "../../../../../../src/api/impl/debug/beacon";

describe("rest - debug - beacon - getHeads", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.DEBUG],
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
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    debugBeaconStub.getHeads.resolves([{slot: 100, root: ZERO_HASH}]);
    const response = await supertest(restApi.server.server)
      .get("/eth/v1/debug/beacon/heads")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
  });

  it("should not found heads", async function () {
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    debugBeaconStub.getHeads.resolves(null);
    await supertest(restApi.server.server).get("/eth/v1/debug/beacon/heads").expect(404);
  });
});
