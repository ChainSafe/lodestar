import {describe} from "mocha";
import {RestApi} from "../../../../../src/api/rest";
import {ApiNamespace} from "../../../../../src/api";
import sinon, {SinonStubbedInstance} from "sinon";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import supertest from "supertest";
import {expect} from "chai";
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import {ValidatorApi} from "../../../../../src/api/impl/validator";

describe("Test beacon rest api", function () {
  this.timeout(10000);

  let restApi: any, beaconApi: SinonStubbedInstance<BeaconApi>, validatorApi: SinonStubbedInstance<ValidatorApi>;


  beforeEach(async function () {
    validatorApi = sinon.createStubInstance(ValidatorApi);
    beaconApi = sinon.createStubInstance(BeaconApi);
    restApi = new RestApi({
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0
    }, {
      logger: sinon.createStubInstance(WinstonLogger),
      beacon: beaconApi,
      validator: validatorApi,
      config
    });
    return await restApi.start();
  });

  afterEach(async function () {
    return await restApi.stop();
  });

  it("should return version", async function () {
    beaconApi.getClientVersion.resolves(Buffer.from(`lodestar-${process.env.npm_package_version}`));
    const response = await supertest(restApi.server.server)
      .get("/node/version")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body).to.be.equal(`lodestar-${process.env.npm_package_version}`);
  });

  it("should return genesis time", async function () {
    const genesis = Math.floor(Date.now()/1000);
    beaconApi.getGenesisTime.resolves(genesis);
    const response = await supertest(restApi.server.server)
      .get("/node/genesis_time")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body).to.be.equal(String(genesis));
  });

  it("should return sync status", async function () {
    beaconApi.getSyncingStatus.resolves(true);
    const response = await supertest(restApi.server.server)
      .get("/node/syncing")
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.is_syncing).to.be.true;
  });

});