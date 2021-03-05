import supertest from "supertest";

import {getHealth} from "../../../../../src/api/rest/controllers/node";
import {urlJoin} from "../utils";
import {NODE_PREFIX, api, restApi} from "./index.test";

describe("rest - node - getHealth", function () {
  it("ready", async function () {
    api.node.getNodeStatus.resolves("ready");
    await supertest(restApi.server.server).get(urlJoin(NODE_PREFIX, getHealth.url)).expect(200);
  });

  it("syncing", async function () {
    api.node.getNodeStatus.resolves("syncing");
    await supertest(restApi.server.server).get(urlJoin(NODE_PREFIX, getHealth.url)).expect(206);
  });

  it("error", async function () {
    api.node.getNodeStatus.resolves("error");
    await supertest(restApi.server.server).get(urlJoin(NODE_PREFIX, getHealth.url)).expect(503);
  });
});
