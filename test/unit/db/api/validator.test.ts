import sinon from "sinon";

import * as dbKeys from "../../../../src/db/schema";
import {Bucket} from "../../../../src/db/schema";
import {LevelDbPersistance} from "../../../../src/db/persistance";
import {Attestation, BeaconBlock} from "../../../../src/types";
import chai, {expect} from "chai";
import {serialize} from "@chainsafe/ssz";
import chaiAsPromised from 'chai-as-promised';
import {ValidatorDB} from "../../../../src/db/api/validator/validator";
import {generateEmptyBlock} from "../../../utils/block";
import {IValidatorDB} from "../../../../src/db/api/validator/interface";
import {generateEmptyAttestation} from "../../../utils/attestation";

chai.use(chaiAsPromised);

describe('beacon db api', function () {

  const sandbox = sinon.createSandbox();

  let encodeKeyStub, dbStub, validatorDB: IValidatorDB;

  beforeEach(() => {
    encodeKeyStub = sandbox.stub(dbKeys, 'encodeKey');
    dbStub = sandbox.createStubInstance(LevelDbPersistance);
    validatorDB = new ValidatorDB({
      persistance: dbStub
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('get validator block', async function () {
    encodeKeyStub.returns('blockKey');
    dbStub.get.withArgs('blockKey').resolves(serialize(generateEmptyBlock(), BeaconBlock));
    await validatorDB.getBlock(1);
    expect(encodeKeyStub.withArgs(Bucket.lastProposedBlock, 1).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockKey').calledOnce).to.be.true;
  });

  it('set validator block', async function () {
    encodeKeyStub.returns('blockKey');
    dbStub.put.resolves({});
    await validatorDB.setBlock(1, generateEmptyBlock());
    expect(encodeKeyStub.withArgs(Bucket.lastProposedBlock, 1).calledOnce).to.be.true;
    expect(dbStub.put.withArgs('blockKey', sinon.match.any).calledOnce).to.be.true;
  });

  it('get validator attestation', async function () {
    encodeKeyStub.returns('attestationKey');
    dbStub.search.resolves([serialize(generateEmptyAttestation(), Attestation)]);
    await validatorDB.getAttestations(1, {gt: 0, lt: 3});
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, "10").calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, "13").calledOnce).to.be.true;
    expect(dbStub.search.calledOnce).to.be.true;
  });

  it('get validator attestation - just lower constraint', async function () {
    encodeKeyStub.returns('attestationKey');
    dbStub.search.resolves([serialize(generateEmptyAttestation(), Attestation)]);
    await validatorDB.getAttestations(1, {gt: 0});
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, "10").calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, "1" + Number.MAX_SAFE_INTEGER).calledOnce).to.be.true;
    expect(dbStub.search.calledOnce).to.be.true;
  });

  it('set validator attestation', async function () {
    encodeKeyStub.returns('attestationKey');
    dbStub.put.resolves({});
    await validatorDB.setAttestation(1, generateEmptyAttestation());
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, "10").calledOnce).to.be.true;
    expect(dbStub.put.withArgs('attestationKey', sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete attestation', async function() {
    encodeKeyStub.returns('attestationKey');
    dbStub.batchDelete.resolves({});
    await validatorDB.deleteAttestations(1, [generateEmptyAttestation(), generateEmptyAttestation()]);
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, "10").calledTwice).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });


});
