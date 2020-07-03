import {RestApi} from "../../../../../../src/api/rest";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ValidatorApi} from "../../../../../../src/api/impl/validator";
import sinon from "sinon";
import {ApiNamespace} from "../../../../../../src/api";
import {StubbedBeaconApi} from "../../../../../utils/stub/beaconApi";
import supertest from "supertest";
import {expect} from "chai";
import {generateSignedBeaconHeaderResponse} from "../../../../../utils/api";
import {toHexString} from "@chainsafe/ssz";
import {getBlockHeaders} from "../../../../../../src/api/rest/controllers/beacon/blocks";

describe("rest - beacon - getBlockHeaders", function () {

  let api: RestApi;
  let beaconApiStub: StubbedBeaconApi;

  beforeEach(async function () {
    beaconApiStub = new StubbedBeaconApi();
    api = new RestApi({
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0
    }, {
      config,
      logger: sinon.createStubInstance(WinstonLogger),
      validator: sinon.createStubInstance(ValidatorApi),
      beacon: beaconApiStub
    });
    await api.start();
  });

  afterEach(async function() {
    await api.stop();
  });

  it("should fetch without filters", async function () {
    beaconApiStub.blocks.getBlockHeaders.resolves([generateSignedBeaconHeaderResponse()]);
    const response = await supertest(api.server.server)
      .get(getBlockHeaders.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });

  it("should parse slot param", async function () {
    beaconApiStub.blocks.getBlockHeaders
      .withArgs({slot: 1, parentRoot: undefined})
      .resolves([generateSignedBeaconHeaderResponse()]);
    const response = await supertest(api.server.server)
      .get(getBlockHeaders.url)
      .query({"slot": "1"})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });

  it("should parse parentRoot param", async function () {
    beaconApiStub.blocks.getBlockHeaders
      .withArgs({slot: undefined, parentRoot: new Uint8Array(32).fill(1)})
      .resolves([generateSignedBeaconHeaderResponse()]);
    const response = await supertest(api.server.server)
      .get(getBlockHeaders.url)
      .query({"parent_root": toHexString(Buffer.alloc(32, 1))})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });

  it("should throw validation error on invalid slot", async function () {
    await supertest(api.server.server)
      .get(getBlockHeaders.url)
      .query({"slot": "abc"})
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it.skip("should throw validation error on invalid parentRoot - not hex", async function () {
    await supertest(api.server.server)
      .get(getBlockHeaders.url)
      .query({"parentRoot": "0xb0e16cdb82ddf08b02aa3898d16a706997b11a69048c80525338d4a7b378d8eg"})
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it.skip("should throw validation error on invalid parentRoot - incorrect length", async function () {
    await supertest(api.server.server)
      .get(getBlockHeaders.url)
      .query({"parentRoot": "0xb0e"})
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it.skip("should throw validation error on invalid parentRoot - missing 0x prefix", async function () {
    await supertest(api.server.server)
      .get(getBlockHeaders.url)
      .query({"parentRoot": "b0e16cdb82ddf08b02aa3898d16a706997b11a69048c80525338d4a7b378d8eb"})
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

});
