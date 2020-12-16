import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/minimal";

import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {StubbedApi} from "../../../../../utils/stub/api";
import {silentLogger} from "../../../../../utils/logger";
import {SinonStubbedInstance} from "sinon";
import {DebugBeaconApi} from "../../../../../../src/api/impl/debug/beacon";
import {generateState} from "../../../../../utils/state";

describe("rest - debug - beacon - getState", function () {
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

  it("should get state json successfully", async function () {
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    debugBeaconStub.getState.resolves(generateState());
    const response = await supertest(restApi.server.server)
      .get("/eth/v1/debug/beacon/states/0xSomething")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
  });

  it("should get state ssz successfully", async function () {
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    const state = generateState();
    debugBeaconStub.getState.resolves(state);
    const response = await supertest(restApi.server.server)
      .get("/eth/v1/debug/beacon/states/0xSomething")
      .accept("application/octet-stream")
      .expect(200)
      .expect("Content-Type", "application/octet-stream");
    expect(response.body).to.be.deep.equal(config.types.BeaconState.serialize(state));
  });

  it("should return status code 404", async function () {
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    debugBeaconStub.getState.resolves(null);
    await supertest(restApi.server.server).get("/eth/v1/debug/beacon/states/0xSomething").expect(404);
  });

  it("should return status code 400", async function () {
    const debugBeaconStub = api.debug.beacon as SinonStubbedInstance<DebugBeaconApi>;
    debugBeaconStub.getState.throws(new Error("Invalid state id"));
    await supertest(restApi.server.server).get("/eth/v1/debug/beacon/states/1000x").expect(400);
  });
});
