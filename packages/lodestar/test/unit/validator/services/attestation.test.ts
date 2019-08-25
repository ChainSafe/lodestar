import {PrivateKey} from "@chainsafe/bls/lib/privateKey";
import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {RpcClientOverInstance} from "../../../../src/validator/rpc";
import {ValidatorApi} from "../../../../src/rpc/api/validator";
import {AttestationService} from "../../../../src/validator/services/attestation";
import {computeEpochOfSlot} from "../../../../src/chain/stateTransition/util";
import {ValidatorDB} from "../../../../src/db/api";
import {ILogger, WinstonLogger} from "../../../../src/logger";
import {generateFork} from "../../../utils/fork";
import {generateAttestationData} from "../../../utils/attestation";

describe('validator attestation service', function () {

  const sandbox = sinon.createSandbox();

  let rpcClientStub, dbStub;
  let logger: ILogger = new WinstonLogger();

  before(() => {
    logger.silent = true;
  });

  beforeEach(() => {
    rpcClientStub = sandbox.createStubInstance(RpcClientOverInstance);
    dbStub = sandbox.createStubInstance(ValidatorDB);
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(() => {
    logger.silent = false;
  });

  it('should not sign conflicting attestation', async function () {
    const slot = 1;
    const shard = 1;
    const attestationData = generateAttestationData(slot, 1);
    rpcClientStub.validator = sandbox.createStubInstance(ValidatorApi);
    rpcClientStub.validator.produceAttestation.withArgs(slot, shard).resolves({data: attestationData});

    dbStub.getAttestations.resolves([
      {
        data: generateAttestationData(slot, 1)
      }
    ]);
    const service = new AttestationService(
      config, 0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishAttestation(slot, shard, generateFork());
    expect(result).to.be.null;
  });

  it('should produce correct block', async function () {
    const slot = 1;
    const shard = 1;
    const attestationData = generateAttestationData(slot, 1);
    rpcClientStub.validator = sandbox.createStubInstance(ValidatorApi);
    rpcClientStub.validator.produceAttestation.withArgs(slot, shard).resolves({data: attestationData});
    rpcClientStub.validator.getCommitteeAssignment.withArgs(0, computeEpochOfSlot(config, slot)).resolves({
      validators: [0]
    });
    dbStub.getAttestations.resolves([]);
    const service = new AttestationService(
      config, 0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishAttestation(slot, shard, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishAttestation.withArgs(
      sinon.match.has('data', attestationData)
        .and(sinon.match.has('signature', sinon.match.defined))
    ).calledOnce).to.be.true;
    expect(
      rpcClientStub.validator.getCommitteeAssignment.withArgs(0, computeEpochOfSlot(config, slot)).calledOnce
    ).to.be.true;
  });

});
