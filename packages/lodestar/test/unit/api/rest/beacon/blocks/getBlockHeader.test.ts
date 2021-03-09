import {expect} from "chai";
import supertest from "supertest";
import {getBlockHeader} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateSignedBeaconHeaderResponse} from "../../../../../utils/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../../index.test";

describe("rest - beacon - getBlockHeader", function () {
  it("should succeed", async function () {
    this.test?.ctx?.beaconBlocksStub.getBlockHeader.withArgs("head").resolves(generateSignedBeaconHeaderResponse());
    const response = await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockHeader.url.replace(":blockId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
  });

  it("should not found block header", async function () {
    this.test?.ctx?.beaconBlocksStub.getBlockHeader.withArgs("4").resolves(null);
    await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockHeader.url.replace(":blockId", "4")))
      .expect(404);
  });

  it("should fail validation", async function () {
    this.test?.ctx?.beaconBlocksStub.getBlockHeader.throws(new Error("Invalid block id"));
    await supertest(this.test?.ctx?.restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockHeader.url.replace(":blockId", "abc")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
