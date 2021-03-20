import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {StateNotFound} from "../../../../../../src/api/impl/errors/api";
import {getStateValidator} from "../../../../../../src/api/rest/controllers/beacon/state/getValidator";
import {generateValidator} from "../../../../../utils/validator";
import {ApiResponseBody, urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {phase0} from "@chainsafe/lodestar-types";
import {BeaconStateApi} from "../../../../../../src/api/impl/beacon/state";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";

describe("rest - beacon - getStateValidator", function () {
  let beaconStateStub: SinonStubbedInstance<BeaconStateApi>;
  let restApi: RestApi;

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconStateStub = restApi.server.api.beacon.state as SinonStubbedInstance<BeaconStateApi>;
  });

  it("should get by root", async function () {
    const pubkey = toHexString(Buffer.alloc(48, 1));
    beaconStateStub.getStateValidator.withArgs("head", config.types.BLSPubkey.fromJson(pubkey)).resolves({
      index: 1,
      balance: BigInt(3200000),
      status: phase0.ValidatorStatus.ACTIVE_ONGOING,
      validator: generateValidator(),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "head").replace(":validatorId", pubkey)))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.balance).to.not.be.undefined;
  });

  it("should get by index", async function () {
    beaconStateStub.getStateValidator.withArgs("head", 1).resolves({
      index: 1,
      balance: BigInt(3200000),
      status: phase0.ValidatorStatus.ACTIVE_ONGOING,
      validator: generateValidator(),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "head").replace(":validatorId", "1")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.balance).to.not.be.undefined;
  });

  it("should not found validator", async function () {
    beaconStateStub.getStateValidator.withArgs("4", 1).resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "4").replace(":validatorId", "1")))
      .expect(404);
    expect(beaconStateStub.getStateValidator.calledOnce).to.be.true;
  });

  it("should not found state", async function () {
    beaconStateStub.getStateValidator.withArgs("4", 1).throws(new StateNotFound());
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidator.url.replace(":stateId", "4").replace(":validatorId", "1")))
      .expect(404);
    expect(beaconStateStub.getStateValidator.calledOnce).to.be.true;
  });
});
