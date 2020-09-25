import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {getBlock} from "../../../../../../src/api/rest/controllers/beacon/blocks";
import {StubbedApi} from "../../../../../utils/stub/api";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {silentLogger} from "../../../../../utils/logger";

describe("rest - beacon - getBlock", function () {
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

  it("should succeed", async function () {
    api.beacon.blocks.getBlock.withArgs("head").resolves(generateEmptySignedBlock());
    const response = await supertest(restApi.server.server)
      .get(getBlock.url.replace(":blockId", "head"))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
  });

  it("should not found block header", async function () {
    api.beacon.blocks.getBlock.withArgs("4").resolves(null);
    await supertest(restApi.server.server).get(getBlock.url.replace(":blockId", "4")).expect(404);
  });

  it("should fail validation", async function () {
    api.beacon.blocks.getBlock.throws(new Error("Invalid block id"));
    await supertest(restApi.server.server)
      .get(getBlock.url.replace(":blockId", "abc"))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
