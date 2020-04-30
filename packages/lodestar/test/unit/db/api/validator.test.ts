import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance, SinonStub} from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {toHexString} from "@chainsafe/ssz";
import {bigIntToBytes, bytesToBigInt} from "@chainsafe/lodestar-utils";

import * as dbKeys from "../../../../src/db/api/schema";
import {Bucket} from "../../../../src/db/api/schema";
import {LevelDbController} from "../../../../src/db/controller";
import {IValidatorDB, ValidatorDB} from "../../../../src/db/api";
import {generateEmptySignedBlock} from "../../../utils/block";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {Id} from "../../../../src/db/api/beacon/repositories";

chai.use(chaiAsPromised);

describe("beacon db api", function () {

  const sandbox = sinon.createSandbox();

  const pubKey = Buffer.alloc(48);

  let encodeKeyStub: SinonStub<[Bucket, Id], Buffer>, dbStub: SinonStubbedInstance<LevelDbController>, validatorDB: IValidatorDB;

  beforeEach(() => {
    encodeKeyStub = sandbox.stub(dbKeys, "encodeKey");
    dbStub = sandbox.createStubInstance(LevelDbController);
    validatorDB = new ValidatorDB({
      config,
      controller: dbStub
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("get validator block", async function () {
    const blockKey = Buffer.alloc(32, 1);
    encodeKeyStub.returns(blockKey);
    dbStub.get.withArgs(blockKey).resolves(config.types.SignedBeaconBlock.serialize(generateEmptySignedBlock()) as Buffer);
    await validatorDB.getBlock(pubKey);
    expect(encodeKeyStub.withArgs(Bucket.lastProposedBlock, toHexString(pubKey)).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(blockKey).calledOnce).to.be.true;
  });

  it("set validator block", async function () {
    const blockKey = Buffer.alloc(32, 1);
    encodeKeyStub.returns(blockKey);
    dbStub.put.resolves();
    await validatorDB.setBlock(pubKey, generateEmptySignedBlock());
    expect(encodeKeyStub.withArgs(Bucket.lastProposedBlock, toHexString(pubKey)).calledOnce).to.be.true;
    expect(dbStub.put.withArgs(blockKey, sinon.match.any).calledOnce).to.be.true;
  });

  it("get validator attestation", async function () {
    const attestationKey = Buffer.alloc(32, 1)
    encodeKeyStub.returns(attestationKey);
    dbStub.values.resolves([config.types.Attestation.serialize(generateEmptyAttestation()) as Buffer]);
    await validatorDB.getAttestations(pubKey, {gt: 0, lt: 3});
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, toHexString(pubKey) + "0").calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, toHexString(bigIntToBytes(bytesToBigInt(pubKey)+1n, 48)) + "3").calledOnce).to.be.true;
    expect(dbStub.values.calledOnce).to.be.true;
  });

  it("get validator attestation - just lower constraint", async function () {
    const attestationKey = Buffer.alloc(32, 1)
    encodeKeyStub.returns(attestationKey);
    dbStub.values.resolves([config.types.Attestation.serialize(generateEmptyAttestation()) as Buffer]);
    await validatorDB.getAttestations(pubKey, {gt: 0});
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, toHexString(pubKey) + "0").calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, toHexString(bigIntToBytes(bytesToBigInt(pubKey)+1n, 48)) + Number.MAX_SAFE_INTEGER).calledOnce).to.be.true;
    expect(dbStub.values.calledOnce).to.be.true;
  });

  it("set validator attestation", async function () {
    const attestationKey = Buffer.alloc(32, 1);
    encodeKeyStub.returns(attestationKey);
    dbStub.put.resolves();
    await validatorDB.setAttestation(pubKey, generateEmptyAttestation());
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, toHexString(pubKey) + "0").calledOnce).to.be.true;
    expect(dbStub.put.withArgs(attestationKey, sinon.match.any).calledOnce).to.be.true;
  });

  it("test delete attestation", async function() {
    const attestationKey = Buffer.alloc(32, 1);
    encodeKeyStub.returns(attestationKey);
    dbStub.batchDelete.resolves();
    await validatorDB.deleteAttestations(pubKey, [generateEmptyAttestation(), generateEmptyAttestation()]);
    expect(encodeKeyStub.withArgs(Bucket.proposedAttestations, toHexString(pubKey) + "0").calledTwice).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

});
