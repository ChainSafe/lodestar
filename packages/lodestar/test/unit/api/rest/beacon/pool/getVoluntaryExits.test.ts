import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../../src/api";
import {getVoluntaryExits} from "../../../../../../src/api/rest/controllers/beacon/pool/getVoluntaryExits";
import {generateEmptySignedVoluntaryExit} from "../../../../../utils/attestation";
import {testLogger} from "../../../../../utils/logger";
import {StubbedApi} from "../../../../../utils/stub/api";
import {urlJoin} from "../../utils";
import {BEACON_PREFIX} from "../index.test";

describe("rest - beacon - getVoluntaryExits", function () {
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
        logger: testLogger(),
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    api.beacon.pool.getVoluntaryExits.withArgs().resolves([generateEmptySignedVoluntaryExit()]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getVoluntaryExits.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data.length).to.be.equal(1);
  });
});
