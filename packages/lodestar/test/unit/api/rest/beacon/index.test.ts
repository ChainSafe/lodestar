import {describe} from "mocha";
import {RestApi} from "../../../../../src/api/rest";
import {ApiNamespace} from "../../../../../src/api";
import sinon from "sinon";
import {WinstonLogger} from "../../../../../src/logger";
import {BeaconChain} from "../../../../../src/chain";
import {BeaconDb} from "../../../../../src/db/api";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {EthersEth1Notifier} from "../../../../../src/eth1";
import supertest from "supertest";
import {expect} from "chai";
import {generateState} from "../../../../utils/state";
import {Sync} from "../../../../../src/sync";

describe('Test beacon rest api', function () {
  this.timeout(10000);

  let restApi;

  const chain = sinon.createStubInstance(BeaconChain);
  const sync = sinon.createStubInstance(Sync);

  before(async function () {
    restApi = new RestApi({
      api: [ApiNamespace.BEACON],
      cors: '*',
      enabled: true,
      host: '127.0.0.1',
      port: 0
    }, {
      logger: new WinstonLogger(),
      chain,
      // @ts-ignore
      sync,
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
    const response = await supertest(restApi.server.server)
      .get('/node/version')
      .expect(200)
      .expect('Content-Type', 'application/json; charset=utf-8');
    expect(response.body).to.be.equal(`lodestar-${process.env.npm_package_version}`);
  });

  it('should return genesis time', async function () {
    chain.latestState = generateState({genesisTime: Date.now()});
    const response = await supertest(restApi.server.server)
      .get('/node/genesis_time')
      .expect(200)
      .expect('Content-Type', 'application/json; charset=utf-8');
    expect(response.body).to.be.equal(chain.latestState.genesisTime);
  });

  it('should return sync status', async function () {
    sync.isSynced.resolves(false);
    const response = await supertest(restApi.server.server)
      .get('/node/syncing')
      .expect(200)
      .expect('Content-Type', 'application/json; charset=utf-8');
    expect(response.body.is_syncing).to.be.true;
  });

});