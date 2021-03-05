import {expect} from "chai";
import supertest from "supertest";

import {getVersion} from "../../../../../src/api/rest/controllers/node";
import {urlJoin} from "../utils";
import {NODE_PREFIX, api, restApi} from "./index.test";

describe("rest - node - getVersion", function () {
  it("should succeed", async function () {
    api.node.getVersion.resolves("test");
    const response = await supertest(restApi.server.server)
      .get(urlJoin(NODE_PREFIX, getVersion.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data).to.not.be.empty;
    expect(response.body.data.version).to.equal("test");
  });
});
