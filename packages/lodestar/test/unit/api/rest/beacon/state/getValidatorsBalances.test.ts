import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {StateNotFound} from "../../../../../../src/api/impl/errors/api";
import {getStateValidatorsBalances} from "../../../../../../src/api/rest/controllers/beacon";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../../index.test";

describe("rest - beacon - getStateValidatorsBalances", function () {
  it("should succeed", async function () {
    this.test?.ctx?.beaconStateStub.getStateValidatorBalances.withArgs("head").resolves([
      {
        index: 1,
        balance: BigInt(32),
      },
    ]);
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidatorsBalances.url.replace(":stateId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.equal(1);
  });

  it("should success with indices filter", async function () {
    const hexPubkey = toHexString(Buffer.alloc(48, 1));
    const pubkey = config.types.BLSPubkey.fromJson(hexPubkey);
    this.test?.ctx?.beaconStateStub.getStateValidatorBalances.withArgs("head", [1, pubkey]).resolves([
      {
        index: 1,
        balance: BigInt(32),
      },
      {
        index: 3,
        balance: BigInt(32),
      },
    ]);
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidatorsBalances.url.replace(":stateId", "head")))
      .query({
        id: [1, hexPubkey],
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.length).to.equal(2);
  });

  it("should not found state", async function () {
    this.test?.ctx?.beaconStateStub.getStateValidatorBalances.withArgs("4").throws(new StateNotFound());
    await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getStateValidatorsBalances.url.replace(":stateId", "4")))
      .expect(404);
    expect(this.test?.ctx?.beaconStateStub.getStateValidatorBalances.calledOnce).to.be.true;
  });
});
