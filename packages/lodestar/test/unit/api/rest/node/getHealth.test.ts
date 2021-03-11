import supertest from "supertest";

import {getHealth} from "../../../../../src/api/rest/controllers/node";
import {urlJoin} from "../utils";
import {NODE_PREFIX, setupRestApiTestServer} from "../index.test";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";
import {RestApi} from "../../../../../src/api";

describe("rest - node - getHealth", function () {
  let nodeStub: StubbedNodeApi;
  let restApi: RestApi;

  before(async function () {
    restApi = await setupRestApiTestServer();
    nodeStub = restApi.server.api.node as StubbedNodeApi;
  });

  it("ready", async function () {
    nodeStub.getNodeStatus.resolves("ready");
    await supertest(restApi.server.server).get(urlJoin(NODE_PREFIX, getHealth.url)).expect(200);
  });

  it("syncing", async function () {
    nodeStub.getNodeStatus.resolves("syncing");
    await supertest(restApi.server.server).get(urlJoin(NODE_PREFIX, getHealth.url)).expect(206);
  });

  it("error", async function () {
    nodeStub.getNodeStatus.resolves("error");
    await supertest(restApi.server.server).get(urlJoin(NODE_PREFIX, getHealth.url)).expect(503);
  });
});
