import {config} from "@chainsafe/lodestar-config/minimal";
import {urlJoin} from "@chainsafe/lodestar-validator/src/util";
import {expect} from "chai";
import supertest from "supertest";
import {CONFIG_PREFIX} from ".";
import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getDepositContract} from "../../../../../src/api/rest/controllers/config";
import {testLogger} from "../../../../utils/logger";
import {StubbedApi} from "../../../../utils/stub/api";

describe("rest - config - getDepositContract", function () {
  let restApi: RestApi;
  let api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi();
    restApi = await RestApi.init(
      {
        api: [ApiNamespace.CONFIG],
        cors: "*",
        enabled: true,
        host: "127.0.0.1",
        port: 0,
      },
      {
        config,
        logger: testLogger(),
        api,
      }
    );
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("ready", async function () {
    const depositContract = {
      chainId: config.params.DEPOSIT_CHAIN_ID,
      address: config.params.DEPOSIT_CONTRACT_ADDRESS,
    };
    const expectedJson = config.types.phase0.Contract.toJson(depositContract, {case: "snake"}) as Record<
      string,
      unknown
    >;
    api.config.getDepositContract.resolves(depositContract);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(CONFIG_PREFIX, getDepositContract.url))
      .expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(Object.keys(response.body.data).length).to.equal(2);
    expect(response.body.data.chain_id).to.equal(Object.values(expectedJson)[0]);
    expect(response.body.data.address).to.equal(Object.values(expectedJson)[1]);
  });
});
