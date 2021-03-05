import {expect} from "chai";
import supertest from "supertest";

import {getSyncingStatus} from "../../../../../src/api/rest/controllers/node";
import {urlJoin} from "../utils";
import {NODE_PREFIX, api, restApi} from "./index.test";

describe("rest - node - getSyncingStatus", function () {
  it("should succeed", async function () {
    api.node.getSyncingStatus.resolves({
      headSlot: BigInt(3),
      syncDistance: BigInt(2),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getSyncingStatus.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.head_slot).to.equal("3");
    expect(response.body.data.sync_distance).to.equal("2");
  });
});
