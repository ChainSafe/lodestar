import {expect} from "chai";
import supertest from "supertest";

import {getBlock} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {ApiResponseBody, urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {IBeaconBlocksApi} from "../../../../../../src/api/impl/beacon/blocks";
import {RestApi} from "../../../../../../src/api";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";

describe("rest - beacon - getBlock", function () {
  let beaconBlocksStub: SinonStubbedInstance<IBeaconBlocksApi>;
  let restApi: RestApi;

  before(async function () {
    restApi = await setupRestApiTestServer();
    beaconBlocksStub = restApi.server.api.beacon.blocks as SinonStubbedInstance<BeaconBlockApi>;
  });

  after(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    beaconBlocksStub.getBlock.withArgs("head").resolves(generateEmptySignedBlock());
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlock.url.replace(":blockId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
  });

  it("should not found block header", async function () {
    beaconBlocksStub.getBlock.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlock.url.replace(":blockId", "4")))
      .expect(404);
  });

  it("should fail validation", async function () {
    beaconBlocksStub.getBlock.throws(new Error("Invalid block id"));
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlock.url.replace(":blockId", "abc")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
