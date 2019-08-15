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
import {Sync} from "../../../../../src/sync";
import * as validatorImpl from "../../../../../src/api/impl/validator";
import {generateEmptyValidatorDuty} from "../../../../../src/chain/factory/duties";
import {expect} from "chai";
import {toHex} from "../../../../../src/util/bytes";
import {generateEmptyBlock} from "../../../../utils/block";
import * as blockUtils from "../../../../../src/chain/factory/block";

describe('Test validator rest API', function () {
  this.timeout(10000);

  let restApi, getDutiesStub, assembleBlockStub;

  const chain = sinon.createStubInstance(BeaconChain);
  const sync = sinon.createStubInstance(Sync);
  const sandbox = sinon.createSandbox();

  before(async function () {
    restApi = new RestApi({
      api: [ApiNamespace.VALIDATOR],
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

  beforeEach(function () {
    getDutiesStub = sandbox.stub(validatorImpl, "getValidatorDuties");
    assembleBlockStub = sandbox.stub(blockUtils, "assembleBlock");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should throw error on invalid request for duties', async function () {
    await supertest(restApi.server.server)
      .get('/validator/duties')
      .expect(400)
      .expect('Content-Type', 'application/json; charset=utf-8');
  });

  it('should return duties', async function () {
    const duty = generateEmptyValidatorDuty(
      Buffer.alloc(48, 1),
      {
        blockProposalSlot: 2,
        attestationShard: 2,
        attestationSlot: 2
      }
    );
    getDutiesStub.resolves([duty]);
    const response = await supertest(restApi.server.server)
      .get(
        '/validator/duties',
      )
      .query({
        "validator_pubkeys[]": toHex(Buffer.alloc(32)),
        epoch: 2
      })
      .expect(200)
      .expect('Content-Type', 'application/json; charset=utf-8');
    expect(response.body.length).to.be.equal(1);
    expect(response.body[0].validator_pubkey).to.be.equal(toHex(duty.validatorPubkey));
    expect(response.body[0].attestation_slot).to.be.equal(2);
    expect(response.body[0].attestation_shard).to.be.equal(2);
    expect(response.body[0].block_proposal_slot).to.be.equal(2);
  });

  it('should throw error on invalid request for block production', async function () {
    await supertest(restApi.server.server)
      .get('/validator/block')
      .expect(400)
      .expect('Content-Type', 'application/json; charset=utf-8');
  });

  it('should return new block', async function () {
    const block = generateEmptyBlock();
    assembleBlockStub.resolves(block);
    const response = await supertest(restApi.server.server)
      .get(
        '/validator/block',
      )
      .query({
        "randao_reveal": toHex(Buffer.alloc(32)),
        slot: 2
      })
      .expect(200)
      .expect('Content-Type', 'application/json; charset=utf-8');
    expect(response.body.parent_root).to.not.be.null;
  });

});