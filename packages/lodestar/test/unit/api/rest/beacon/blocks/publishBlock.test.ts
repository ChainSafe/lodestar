import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {publishBlock} from "../../../../../../src/api/rest/controllers/beacon/blocks/publishBlock";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../../../../src/api/impl/beacon/blocks";

describe("rest - beacon - publishBlock", function () {
  let beaconBlocksStub: SinonStubbedInstance<IBeaconBlocksApi>;
  let restApi: RestApi;

  beforeEach(async function () {
    restApi = await setupRestApiTestServer();
    beaconBlocksStub = restApi.server.api.beacon.blocks as SinonStubbedInstance<BeaconBlockApi>;
  });

  it("should succeed", async function () {
    const block = generateEmptySignedBlock();
    beaconBlocksStub.publishBlock.resolves();
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, publishBlock.url))
      .send(config.types.phase0.SignedBeaconBlock.toJson(block, {case: "snake"}) as Record<string, unknown>)
      .expect(200)
      .expect("Content-Type", "application/json");
  });

  it("bad body", async function () {
    await supertest(restApi.server.server)
      .post(urlJoin(BEACON_PREFIX, publishBlock.url))
      .send({})
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(beaconBlocksStub.publishBlock.notCalled).to.be.true;
  });
});
