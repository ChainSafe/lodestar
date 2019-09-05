import chai, {expect} from "chai";
import chaiAsPromised from 'chai-as-promised';
import sinon from "sinon";
import {serialize} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {describe} from "mocha";
import * as dbKeys from "../../../../src/db/schema";
import {Bucket} from "../../../../src/db/schema";
import {LevelDbController} from "../../../../src/db/controller";
import {IValidatorDB, ValidatorDB} from "../../../../src/db/api";
import {generateEmptyBlock} from "../../../utils/block";
import {generateEmptyAttestation} from "../../../utils/attestation";
import BN from "bn.js";

chai.use(chaiAsPromised);

describe('beacon db api', function () {

  const sandbox = sinon.createSandbox();

  const pubKey = Buffer.alloc(48);

  let encodeKeyStub, dbStub, validatorDB: IValidatorDB;

  beforeEach(() => {
    encodeKeyStub = sandbox.stub(dbKeys, 'encodeKey');
    dbStub = sandbox.createStubInstance(LevelDbController);
    validatorDB = new ValidatorDB({
      config,
      controller: dbStub
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('get validator block', async function () {
    encodeKeyStub.returns('blockKey');
    dbStub.get.withArgs('blockKey').resolves(serialize(generateEmptyBlock(), config.types.BeaconBlock));
    await validatorDB.getBlock(pubKey);
    expect(encodeKeyStub.withArgs(Bucket.lastProposedBlock, pubKey.toString('hex')).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockKey').calledOnce).to.be.true;
  });

  it('set validator block', async function () {
    encodeKeyStub.returns('blockKey');
    dbStub.put.resolves({});
    await validatorDB.setBlock(pubKey, generateEmptyBlock());
    expect(encodeKeyStub.withArgs(Bucket.lastProposedBlock, pubKey.toString('hex')).calledOnce).to.be.true;
    expect(dbStub.put.withArgs('blockKey', sinon.match.any).calledOnce).to.be.true;
  });

  it('get validator attestation', async function () {
    encodeKeyStub.returns('attestationKey');
    dbStub.search.resolves([serialize(generateEmptyAttestation(), config.types.Attestation)]);
    await validatorDB.getAttestations(pubKey, {gt: 0, lt: 3});
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, pubKey.toString('hex') + "0").calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, new BN(pubKey).addn(1).toString('hex').replace('0x', '') + "3").calledOnce).to.be.true;
    expect(dbStub.search.calledOnce).to.be.true;
  });

  it('get validator attestation - just lower constraint', async function () {
    encodeKeyStub.returns('attestationKey');
    dbStub.search.resolves([serialize(generateEmptyAttestation(), config.types.Attestation)]);
    await validatorDB.getAttestations(pubKey, {gt: 0});
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, pubKey.toString('hex') + "0").calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, new BN(pubKey).addn(1).toString('hex').replace('0x', '') + Number.MAX_SAFE_INTEGER).calledOnce).to.be.true;
    expect(dbStub.search.calledOnce).to.be.true;
  });

  it('set validator attestation', async function () {
    encodeKeyStub.returns('attestationKey');
    dbStub.put.resolves({});
    await validatorDB.setAttestation(pubKey, generateEmptyAttestation());
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, pubKey.toString('hex') + "0").calledOnce).to.be.true;
    expect(dbStub.put.withArgs('attestationKey', sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete attestation', async function() {
    encodeKeyStub.returns('attestationKey');
    dbStub.batchDelete.resolves({});
    await validatorDB.deleteAttestations(pubKey, [generateEmptyAttestation(), generateEmptyAttestation()]);
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, pubKey.toString('hex') + "0").calledTwice).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

});
