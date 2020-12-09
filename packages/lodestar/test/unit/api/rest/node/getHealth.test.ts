import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/minimal";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getHealth} from "../../../../../src/api/rest/controllers/node";
import {StubbedApi} from "../../../../utils/stub/api";
import {silentLogger} from "../../../../utils/logger";
import {urlJoin} from "../utils";
import {NODE_PREFIX} from "./index";

describe("rest - node - getHealth", function () {
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
