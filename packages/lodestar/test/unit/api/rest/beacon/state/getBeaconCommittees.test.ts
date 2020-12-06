import {config} from "@chainsafe/lodestar-config/minimal";
import {ValidatorIndex} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {StateNotFound} from "../../../../../../src/api/impl/errors/api";
import {getStateBeaconCommittees} from "../../../../../../src/api/rest/controllers/beacon/state";
import {silentLogger} from "../../../../../utils/logger";
import {StubbedApi} from "../../../../../utils/stub/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";

describe("rest - beacon - getStateBeaconCommittees", function () {
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

  it("should succeed without filters", async function () {
    api.beacon.state.getStateCommittees.withArgs("head").resolves([
      {
        index: 0,
        slot: 1,
        validators: [1, 2, 3] as List<ValidatorIndex>,
      },
    ]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateBeaconCommittees.url.replace(":stateId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.be.equal(1);
  });

  it("should succeed with filters", async function () {
    api.beacon.state.getStateCommittees.withArgs("head", {slot: 1, epoch: 0, index: 10}).resolves([
      {
        index: 0,
        slot: 1,
        validators: [1, 2, 3] as List<ValidatorIndex>,
      },
    ]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateBeaconCommittees.url.replace(":stateId", "head")))
      .query({
        slot: "1",
        epoch: "0",
        index: "10",
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.be.equal(1);
  });

  it("string slot", async function () {
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateBeaconCommittees.url.replace(":stateId", "head")))
      .query({
        slot: "1a",
        epoch: "0",
        index: "10",
      })
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("negative epoch", async function () {
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateBeaconCommittees.url.replace(":stateId", "head")))
      .query({
        slot: "1",
        epoch: "-2",
        index: "10",
      })
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("should not found state", async function () {
    api.beacon.state.getStateCommittees.withArgs("4").throws(new StateNotFound());
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateBeaconCommittees.url.replace(":stateId", "4")))
      .expect(404);
    expect(api.beacon.state.getStateCommittees.calledOnce).to.be.true;
  });
});
