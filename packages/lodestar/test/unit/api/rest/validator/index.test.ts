import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import sinon from "sinon";
import supertest from "supertest";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {generateEmptyBlock} from "../../../../utils/block";
import {StubbedApi} from "../../../../utils/stub/api";

export const VALIDATOR_PREFIX = "/eth/v1/validator";

describe("Test validator rest API", function () {
  let restApi: RestApi, api: StubbedApi;
  const sandbox = sinon.createSandbox();

  beforeEach(async function () {
    api = new StubbedApi(sandbox);
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.VALIDATOR],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        logger: sandbox.createStubInstance(WinstonLogger),
        config,
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
    sandbox.restore();
  });

  it("should throw error on invalid request for block production", async function () {
    await supertest(restApi.server.server)
      .get("/eth/v1/validator/blocks/1")
      .expect(400)
      .expect("Content-Type", "application/json; charset=utf-8");
  });

  it("should return new block", async function () {
    const block = generateEmptyBlock();
    api.validator.produceBlock.resolves(block);
    const response = await supertest(restApi.server.server)
      .get("/eth/v1/validator/blocks/1")
      .query({
        // eslint-disable-next-line @typescript-eslint/camelcase
        randao_reveal: toHexString(Buffer.alloc(32)),
      })
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.parent_root).to.not.be.null;
  });
});
