import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {describe, it, beforeEach, afterEach} from "mocha";
import {ILogger} from "../../../lib/logger/interface";
import {WinstonLogger} from "@chainsafe/lodestar/lib/logger";
import {ValidatorDB} from "@chainsafe/lodestar/lib/db";
import {generateAttestationData} from "@chainsafe/lodestar/test/utils/attestation";
import {ApiClientOverInstance} from "../../../src/api";
import {AttestationService} from "../../../src/services/attestation";
import {generateFork} from "@chainsafe/lodestar/test/utils/fork";
import BN from "bn.js";

describe("validator attestation service", function () {

  const sandbox = sinon.createSandbox();

  let rpcClientStub: any, dbStub: any;
  const logger: ILogger = sinon.createStubInstance(WinstonLogger);


  beforeEach(() => {
    rpcClientStub = sandbox.createStubInstance(ApiClientOverInstance);
    dbStub = sandbox.createStubInstance(ValidatorDB);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should not sign conflicting attestation", async function () {
    this.timeout(10000);
    const slot = 1;
    const shard = 1;
    const attestationData = generateAttestationData(slot, 1);
    rpcClientStub.validator = {
      produceAttestation: sinon.stub(),
      publishAttestation: sinon.stub()
    };
    rpcClientStub.validator.produceAttestation
      .withArgs(sinon.match.any, false, slot, shard)
      .resolves({data: attestationData});

    dbStub.getAttestations.resolves([
      {
        data: generateAttestationData(slot, 1)
      }
    ]);
    const service = new AttestationService(
      config,
      new Keypair(PrivateKey.fromBytes(new BN(98).toBuffer("be", 32))),
      rpcClientStub,
      dbStub,
      logger
    );
    const result = await service.createAndPublishAttestation(slot, shard, generateFork());
    expect(result).to.be.null;
  });

  it("should produce correct block", async function () {
    this.timeout(10000);
    const slot = 1;
    const shard = 1;
    const attestationData = generateAttestationData(slot, 1);
    rpcClientStub.validator = {
      produceAttestation: sinon.stub(),
      publishAttestation: sinon.stub()
    };
    rpcClientStub.validator.produceAttestation
      .withArgs(sinon.match.any, false, slot, shard)
      .resolves({data: attestationData});
    dbStub.getAttestations.resolves([]);
    const service = new AttestationService(
      config,
      new Keypair(PrivateKey.fromBytes(new BN(99).toBuffer("be", 32))),
      rpcClientStub,
      dbStub,
      logger
    );
    const result = await service.createAndPublishAttestation(slot, shard, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishAttestation.withArgs(
      sinon.match.has("data", attestationData)
        .and(sinon.match.has("signature", sinon.match.defined))
    ).calledOnce).to.be.true;
  });

});
