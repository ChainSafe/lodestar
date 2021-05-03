import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/minimal";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {StubbedApi} from "../../../../utils/stub/api";
import {testLogger} from "../../../../utils/logger";
import {SinonStubbedInstance} from "sinon";
import {DebugBeaconApi} from "../../../../../src/api/impl/debug/beacon";
import {generateState} from "../../../../utils/state";
import {ApiResponseBody} from "../utils";

describe("rest - debug - getState", function () {
  let restApi: RestApi;
  let api: StubbedApi;
  let debugBeaconStub: SinonStubbedInstance<DebugBeaconApi>;

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
      {config, logger: testLogger(), api, metrics: null}
    );
    debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should get state json successfully", async function () {
    debugBeaconStub.getState.resolves(generateState());
    const response = await supertest(restApi.server.server)
      .get("/eth/v1/debug/beacon/states/0xSomething")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
  });

  it("should get state ssz successfully", async function () {
    const state = generateState();
    debugBeaconStub.getState.resolves(state);
    const response = await supertest(restApi.server.server)
      .get("/eth/v1/debug/beacon/states/0xSomething")
      .accept("application/octet-stream")
      .expect(200)
      .expect("Content-Type", "application/octet-stream");
    expect(response.body).to.be.deep.equal(config.getTypes(state.slot).BeaconState.serialize(state));
  });
});
