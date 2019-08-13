import {describe} from "mocha";
import {RestApi} from "../../../../src/api/rest";
import {ApiNamespace} from "../../../../src/api";
import sinon from "sinon";
import {WinstonLogger} from "../../../../src/logger";
import {BeaconChain} from "../../../../src/chain";
import {BeaconDb} from "../../../../src/db/api";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {EthersEth1Notifier} from "../../../../src/eth1";
import supertest = require("supertest");

describe('Test rest api server', function () {
  this.timeout(10000);

  let restApi;

  before(async function () {
    restApi = new RestApi({
      api: [ApiNamespace.BEACON],
      cors: '*',
      enabled: true,
      host: '127.0.0.1',
      port: 0
    }, {
      logger: new WinstonLogger(),
      chain: sinon.createStubInstance(BeaconChain),
      db: sinon.createStubInstance(BeaconDb),
      config,
      eth1: sinon.createStubInstance(EthersEth1Notifier),
    });
    return await restApi.start();
  });

  after(async function () {
    return await restApi.stop();
  });

  it('should return version', async function () {
    await supertest(restApi.server.server)
      .get('/node/version')
      .expect(00)
      .expect('Content-Type', 'application/json; charset=utf-8');
  });

});