import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/minimal";

import {generateState} from "../../../../../utils/state";

describe("rest - debug - beacon - getState", function () {
  it("should get state json successfully", async function () {
    this.test?.ctx?.debugBeaconStub.getState.resolves(generateState());
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get("/eth/v1/debug/beacon/states/0xSomething")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
  });

  it("should get state ssz successfully", async function () {
    const state = generateState();
    this.test?.ctx?.debugBeaconStub.getState.resolves(state);
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get("/eth/v1/debug/beacon/states/0xSomething")
      .accept("application/octet-stream")
      .expect(200)
      .expect("Content-Type", "application/octet-stream");
    expect(response.body).to.be.deep.equal(config.types.phase0.BeaconState.serialize(state));
  });

  it("should return status code 404", async function () {
    this.test?.ctx?.debugBeaconStub.getState.resolves(null);
    await supertest(this.test?.ctx?.restApi.server.server).get("/eth/v1/debug/beacon/states/0xSomething").expect(404);
  });

  it("should return status code 400", async function () {
    this.test?.ctx?.debugBeaconStub.getState.throws(new Error("Invalid state id"));
    await supertest(this.test?.ctx?.restApi.server.server).get("/eth/v1/debug/beacon/states/1000x").expect(400);
  });
});
