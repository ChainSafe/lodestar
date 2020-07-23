import {describe} from "mocha";
import {RestApi} from "../../../../../src/api/rest";
import {ApiNamespace} from "../../../../../src/api";
import sinon, {SinonStubbedInstance} from "sinon";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import {ValidatorApi} from "../../../../../src/api/impl/validator";
import {StubbedNodeApi} from "../../../../utils/stub/nodeApi";
import supertest from "supertest";
import {expect} from "chai";
import {getGenesis} from "../../../../../lib/api/rest/controllers/beacon";

describe("rest - beacon - getGenesis", function () {

  let restApi: RestApi,
    beaconApiStub: SinonStubbedInstance<BeaconApi>,
    validatorApiStub: SinonStubbedInstance<ValidatorApi>;


  beforeEach(async function () {
    validatorApiStub = sinon.createStubInstance(ValidatorApi);
    beaconApiStub = sinon.createStubInstance(BeaconApi);
    restApi = new RestApi({
      api: [ApiNamespace.BEACON],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0
    }, {
      logger: sinon.createStubInstance(WinstonLogger),
      beacon: beaconApiStub,
      validator: validatorApiStub,
      node: new StubbedNodeApi(),
      config
    });
    return await restApi.start();
  });

  afterEach(async function () {
    return await restApi.stop();
  });

  it("should get genesis object",  async function () {
    beaconApiStub.getGenesis.resolves({
      genesisForkVersion:config.params.GENESIS_FORK_VERSION,
      genesisTime: BigInt(0),
      genesisValidatorsRoot: Buffer.alloc(32)
    });
    const response = await supertest(restApi.server.server)
      .get(getGenesis.url)
      .expect(200)
      .expect("Content-Type", "application/json; charset=utf-8");
    expect(response.body.data).to.not.be.undefined;
    expect(response.body.data.genesis_time).to.equal("0");
    expect(response.body.data.genesis_validators_root).to.not.be.empty;
  });

  it("should return 404 if no genesis",  async function () {
    beaconApiStub.getGenesis.resolves(null);
    await supertest(restApi.server.server)
      .get(getGenesis.url)
      .expect(404);
  });

});
