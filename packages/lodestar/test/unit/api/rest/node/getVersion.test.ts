import {expect} from "chai";
import supertest from "supertest";

import {getVersion} from "../../../../../src/api/rest/controllers/node";
import {ApiResponseBody, urlJoin} from "../utils";
import {NODE_PREFIX, setupRestApiTestServer} from "../index.test";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";

describe("rest - node - getVersion", function () {
  it("should succeed", async function () {
    const restApi = await setupRestApiTestServer();
    const nodeStub = restApi.server.api.node as StubbedNodeApi;

    nodeStub.getVersion.resolves("test");
    const response = await supertest(restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getVersion.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data).to.not.be.empty;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.version).to.equal("test");
  });
});
