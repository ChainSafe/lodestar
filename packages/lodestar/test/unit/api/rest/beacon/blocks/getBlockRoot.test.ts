import {expect} from "chai";
import supertest from "supertest";
import {toHexString} from "@chainsafe/ssz";

import {getBlockRoot} from "../../../../../../src/api/rest/beacon/blocks/getBlockRoot";
import {setupRestApiTestServer} from "../../index.test";
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
    const root = Buffer.alloc(32, 0x4d);
    beaconBlocksStub.getBlockRoot.withArgs("head").resolves(root);
    const response = await supertest(restApi.server.server)
      .get(getBlockRoot.url.replace(":blockId", "head"))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.root).to.be.equal(toHexString(root));
  });
});
