import {expect} from "chai";
import supertest from "supertest";

import {getPeer} from "../../../../../src/api/rest/controllers/node";
import {ApiResponseBody, urlJoin} from "../utils";
import {NODE_PREFIX, setupRestApiTestServer} from "../index.test";
import {RestApi} from "../../../../../src/api";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";

describe("rest - node - getPeer", function () {
  let nodeStub: StubbedNodeApi;
  let restApi: RestApi;

  before(async function () {
    restApi = await setupRestApiTestServer();
    nodeStub = restApi.server.api.node as StubbedNodeApi;
  });

  it("should succeed", async function () {
    nodeStub.getPeer.resolves({
      lastSeenP2pAddress: "/ip4/127.0.0.1/tcp/36000",
      direction: "inbound",
      enr: "enr-",
      peerId: "16",
      state: "connected",
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getPeer.url.replace(":peerId", "16")))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data).to.not.be.empty;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.peer_id).to.equal("16");
  });

  it("peer not found", async function () {
    nodeStub.getPeer.resolves(null);
    await supertest(restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getPeer.url.replace(":peerId", "16")))
      .expect(404);
  });
});
