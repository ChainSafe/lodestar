import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {publishBlock} from "../../../../../../src/api/rest/controllers/beacon/blocks/publishBlock";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {silentLogger} from "../../../../../utils/logger";
import {StubbedApi} from "../../../../../utils/stub/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";

describe("rest - beacon - publishBlock", function () {
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
    const block = generateEmptySignedBlock();
    api.beacon.blocks.publishBlock.resolves();
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
    expect(api.beacon.blocks.publishBlock.notCalled).to.be.true;
  });
});
