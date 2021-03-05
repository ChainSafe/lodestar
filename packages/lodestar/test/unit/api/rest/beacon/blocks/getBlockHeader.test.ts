import {expect} from "chai";
import supertest from "supertest";
import {getBlockHeader} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {generateSignedBeaconHeaderResponse} from "../../../../../utils/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX, api, restApi} from "../index.test";

describe("rest - beacon - getBlockHeader", function () {
  it("should succeed", async function () {
    api.beacon.blocks.getBlockHeader.withArgs("head").resolves(generateSignedBeaconHeaderResponse());
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockHeader.url.replace(":blockId", "head")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
  });

  it("should not found block header", async function () {
    api.beacon.blocks.getBlockHeader.withArgs("4").resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockHeader.url.replace(":blockId", "4")))
      .expect(404);
  });

  it("should fail validation", async function () {
    api.beacon.blocks.getBlockHeader.throws(new Error("Invalid block id"));
    await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getBlockHeader.url.replace(":blockId", "abc")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
