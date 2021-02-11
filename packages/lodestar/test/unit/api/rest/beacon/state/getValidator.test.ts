import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {StateNotFound} from "../../../../../../src/api/impl/errors/api";
import {getStateValidator} from "../../../../../../src/api/rest/controllers/beacon/state/getValidator";
import {silentLogger} from "../../../../../utils/logger";
import {StubbedApi} from "../../../../../utils/stub/api";
import {generateValidator} from "../../../../../utils/validator";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";
import {ValidatorStatus} from "@chainsafe/lodestar-types";

describe("rest - beacon - getStateValidator", function () {
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

  it("should get by root", async function () {
    const pubkey = toHexString(Buffer.alloc(48, 1));
    api.beacon.state.getStateValidator.withArgs("head", config.types.BLSPubkey.fromJson(pubkey)).resolves({
      index: 1,
      balance: BigInt(3200000),
      status: ValidatorStatus.ACTIVE_ONGOING,
      validator: generateValidator(),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "head").replace(":validatorId", pubkey)))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.balance).to.not.be.undefined;
  });

  it("should get by index", async function () {
    api.beacon.state.getStateValidator.withArgs("head", 1).resolves({
      index: 1,
      balance: BigInt(3200000),
      status: ValidatorStatus.ACTIVE_ONGOING,
      validator: generateValidator(),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "head").replace(":validatorId", "1")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.balance).to.not.be.undefined;
  });

  it("should not found validator", async function () {
    api.beacon.state.getStateValidator.withArgs("4", 1).resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "4").replace(":validatorId", "1")))
      .expect(404);
    expect(api.beacon.state.getStateValidator.calledOnce).to.be.true;
  });

  it("should not found state", async function () {
    api.beacon.state.getStateValidator.withArgs("4", 1).throws(new StateNotFound());
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "4").replace(":validatorId", "1")))
      .expect(404);
    expect(api.beacon.state.getStateValidator.calledOnce).to.be.true;
  });
});
