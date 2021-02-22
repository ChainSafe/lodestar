import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/minimal";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getPeers} from "../../../../../src/api/rest/controllers/node";
import {StubbedApi} from "../../../../utils/stub/api";
import {testLogger} from "../../../../utils/logger";
import {urlJoin} from "../utils";
import {NODE_PREFIX} from "./index";

describe("rest - node - getPeers", function () {
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
        logger: testLogger(),
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should succeed", async function () {
    api.node.getPeers.withArgs(["connected"], undefined).resolves([
      {
        lastSeenP2pAddress: "/ip4/127.0.0.1/tcp/36000",
        direction: "inbound",
        enr: "enr-",
        peerId: "16",
        state: "connected",
      },
    ]);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getPeers.url))
      .query({state: "connected"})
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.length).to.equal(1);
    expect(response.body.data[0].peer_id).to.equal("16");
  });
});
