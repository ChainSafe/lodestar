import {expect} from "chai";
import sinon from "sinon";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getPeer} from "../../../../../src/api/rest/controllers/node";
import {StubbedApi} from "../../../../utils/stub/api";
import {silentLogger} from "../../../../utils/logger";

describe("rest - node - getPeer", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.NODE],
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
    api.node.getPeer.resolves({
      address: "/ip4/127.0.0.1/tcp/36000",
      direction: "inbound",
      enr: "enr-",
      peerId: "16",
      state: "connected",
    });
    const response = await supertest(restApi.server.server)
      .get(getPeer.url.replace(":peerId", "16"))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.peer_id).to.equal("16");
  });

  it("peer not found", async function () {
    api.node.getPeer.resolves(null);
    await supertest(restApi.server.server).get(getPeer.url.replace(":peerId", "16")).expect(404);
  });
});
