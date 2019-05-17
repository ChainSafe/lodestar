import sinon from "sinon";

import * as dbKeys from "../../../../src/db/schema";
import {Bucket, Key} from "../../../../src/db/schema";
import {LevelDbPersistance} from "../../../../src/db/persistance";
import {Attestation, BeaconBlock, BeaconState} from "../../../../src/types";
import {generateState} from "../../../utils/state";
import chai, {expect} from "chai";
import {serialize} from "@chainsafe/ssz";
import chaiAsPromised from 'chai-as-promised';
import {ValidatorDB} from "../../../../src/db/api/validator/validator";
import {generateEmptyBlock} from "../../../utils/block";
import {IValidatorDB} from "../../../../src/db/api/validator/interface";
import {generateEmptyAttestation} from "../../../utils/attestation";

chai.use(chaiAsPromised);

describe('beacon db api', function() {

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
    dbStub.get.withArgs('attestationKey').resolves(serialize(generateEmptyAttestation(), Attestation));
    await validatorDB.getAttestation(1);
    expect(encodeKeyStub.withArgs(Bucket.lastProposedAttestation, 1).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('attestationKey').calledOnce).to.be.true;
  });

  it('set validator attestation', async function () {
    encodeKeyStub.returns('attestationKey');
    dbStub.put.resolves({});
    await validatorDB.setAttestation(1, generateEmptyAttestation());
    expect(encodeKeyStub.withArgs(Bucket.lastProposedAttestation, 1).calledOnce).to.be.true;
    expect(dbStub.put.withArgs('attestationKey', sinon.match.any).calledOnce).to.be.true;
  });


});
