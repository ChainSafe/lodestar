import {expect} from "chai";
import supertest from "supertest";

import {getSyncingStatus} from "../../../../../src/api/rest/controllers/node";
import {ApiResponseBody, urlJoin} from "../utils";
import {NODE_PREFIX, setupRestApiTestServer} from "../index.test";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";

describe("rest - node - getSyncingStatus", function () {
  it("should succeed", async function () {
    const restApi = await setupRestApiTestServer();
    const nodeStub = restApi.server.api.node as StubbedNodeApi;

    nodeStub.getSyncingStatus.resolves({
      headSlot: BigInt(3),
      syncDistance: BigInt(2),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getSyncingStatus.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect((response.body as ApiResponseBody).data).to.not.be.undefined;
    expect((response.body as ApiResponseBody).data).to.not.be.empty;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.head_slot).to.equal("3");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data.sync_distance).to.equal("2");
  });
});
