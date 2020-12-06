import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {produceBlockController} from "../../../../../src/api/rest/controllers/validator/produceBlock";
import {generateEmptyBlock} from "../../../../utils/block";
import {silentLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";
import {urlJoin} from "../utils";
import {VALIDATOR_PREFIX} from "./index.test";

describe("rest - validator - produceBlock", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.VALIDATOR],
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
    api.validator.produceBlock.resolves(generateEmptyBlock());
    const response = await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceBlockController.url.replace(":slot", "5")))
      .query({
        // eslint-disable-next-line @typescript-eslint/camelcase
        randao_reveal: toHexString(Buffer.alloc(32, 1)),
        graffiti: "0x2123",
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(api.validator.produceBlock.withArgs(5, Buffer.alloc(32, 1), "0x2123"));
  });

  it("missing randao reveal", async function () {
    await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceBlockController.url.replace(":slot", "5")))
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("invalid slot", async function () {
    await supertest(restApi.server.server)
      .get(urlJoin(VALIDATOR_PREFIX, produceBlockController.url.replace(":slot", "0")))
      .query({
        // eslint-disable-next-line @typescript-eslint/camelcase
        randao_reveal: toHexString(Buffer.alloc(32, 1)),
      })
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });
});
