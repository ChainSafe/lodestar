import {expect} from "chai";
import supertest from "supertest";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/minimal";

import {getBlockRoot} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, setupRestApiTestServer} from "../../index.test";
import {SinonStubbedInstance} from "sinon";
import {RestApi} from "../../../../../../src/api";
import {BeaconBlockApi, IBeaconBlocksApi} from "../../../../../../src/api/impl/beacon/blocks";

describe("rest - beacon - getBlockRoot", function () {
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
    const block = generateEmptySignedBlock();
    beaconBlocksStub.getBlock.withArgs("head").resolves(block);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockRoot.url.replace(":blockId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.root).to.be.equal(
      toHexString(config.types.phase0.BeaconBlock.hashTreeRoot(block.message))
    );
  });

  it("should not found block header", async function () {
    beaconBlocksStub.getBlock.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockRoot.url.replace(":blockId", "4")))
      .expect(404);
  });

  it("should fail validation", async function () {
    beaconBlocksStub.getBlock.throws(new Error("Invalid block id"));
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockRoot.url.replace(":blockId", "abc")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
