import {expect} from "chai";
import supertest from "supertest";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getSyncingStatus} from "../../../../../src/api/rest/controllers/node";
import {StubbedApi} from "../../../../utils/stub/api";
import {silentLogger} from "../../../../utils/logger";
import {urlJoin} from "../utils";
import {NODE_PREFIX} from "./index";

describe("rest - node - getSyncingStatus", function () {
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
