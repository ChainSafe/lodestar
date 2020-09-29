import sinon from "sinon";
import supertest from "supertest";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

import {ApiNamespace, RestApi} from "../../../../../src/api";
import {getGenesis} from "../../../../../src/api/rest/controllers/beacon";
import {StubbedApi} from "../../../../utils/stub/api";
import {silentLogger} from "../../../../utils/logger";
import {urlJoin} from "../utils";
import {BEACON_PREFIX} from "./index.test";

describe("rest - beacon - getGenesis", function () {
  let restApi: RestApi, api: StubbedApi;

  beforeEach(async function () {
    api = new StubbedApi(sinon);
    restApi = await RestApi.init({
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0,
    }, {
      config,
      logger: silentLogger,
      api,
    });
  });

  afterEach(async function () {
    await restApi.close();
  });

  it("should get genesis object", async function () {
    api.beacon.getGenesis.resolves({
      genesisForkVersion: config.params.GENESIS_FORK_VERSION,
      genesisTime: BigInt(0),
      genesisValidatorsRoot: Buffer.alloc(32),
    });
    const response = await supertest(restApi.server.server)
      .get(urlJoin(BEACON_PREFIX, getGenesis.url))
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.genesis_time).to.equal("0");
    expect(response.body.data.genesis_validators_root).to.not.be.empty;
  });

  it("should return 404 if no genesis", async function () {
    api.beacon.getGenesis.resolves(null);
    await supertest(restApi.server.server).get(urlJoin(BEACON_PREFIX, getGenesis.url)).expect(404);
  });
});
