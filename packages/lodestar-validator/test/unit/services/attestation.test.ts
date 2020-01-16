import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {afterEach, beforeEach, describe, it} from "mocha";
import {ILogger} from "../../../lib";
import {WinstonLogger} from "@chainsafe/lodestar/lib/logger";
import {ValidatorDB} from "@chainsafe/lodestar/lib/db";
import {ApiClientOverInstance} from "../../../src/api";
import {AttestationService} from "../../../src/services/attestation";
import {toBufferBE} from "bigint-buffer";
import {ValidatorDuty} from "@chainsafe/eth2.0-types";
import {generateFork} from "@chainsafe/lodestar/test/utils/fork";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptyAttestation
} from "@chainsafe/lodestar/test/utils/attestation";

const clock = sinon.useFakeTimers({shouldAdvanceTime: true, toFake: ["setTimeout"]});


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

  after(function () {
    clock.restore();
  });
  
  it("on new epoch - no duty", async function () {
    const  keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(98n, 32)));
    rpcClientStub.validator = {
      getAttesterDuties: sinon.stub()
    };
    const service = new AttestationService(
      config,
      keypair,
      rpcClientStub,
      dbStub,
      logger
    );
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    await service.onNewEpoch(1);
    expect(
      rpcClientStub.validator.getAttesterDuties.withArgs(2, [keypair.publicKey.toBytesCompressed()]).calledOnce
    ).to.be.true;
  });

  it("on new epoch - with duty", async function () {
    const  keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(98n, 32)));
    rpcClientStub.validator = {
      getAttesterDuties: sinon.stub(),
      isAggregator: sinon.stub()
    };
    rpcClientStub.beacon = {
      getFork: sinon.stub()
    };
    const service = new AttestationService(
      config,
      keypair,
      rpcClientStub,
      dbStub,
      logger
    );
    const duty: ValidatorDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed()
    };
    rpcClientStub.validator.getAttesterDuties.resolves([duty]);
    rpcClientStub.beacon.getFork.resolves({fork: generateFork()});
    rpcClientStub.validator.isAggregator.resolves(false);
    await service.onNewEpoch(1);
    expect(
      rpcClientStub.validator.getAttesterDuties.withArgs(2, [keypair.publicKey.toBytesCompressed()]).calledOnce
    ).to.be.true;
    expect(rpcClientStub.beacon.getFork.calledOnce).to.be.true;
    expect(rpcClientStub.validator.isAggregator.withArgs(1, 1,  sinon.match.any).calledOnce).to.be.true;
  });
  
  it("on  new slot - without duty", async function () {
    const  keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(98n, 32)));
    const service = new AttestationService(
      config,
      keypair,
      rpcClientStub,
      dbStub,
      logger
    );
    await service.onNewSlot(0);
  });
  
  it("on  new slot - with duty - not aggregator", async function () {
    const  keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(98n, 32)));
    rpcClientStub.beacon = {
      getFork: sinon.stub()
    };
    rpcClientStub.validator = {
      produceAttestation: sinon.stub(),
      publishAttestation: sinon.stub()
    };
    const service = new AttestationService(
      config,
      keypair,
      rpcClientStub,
      dbStub,
      logger
    );
    const duty: ValidatorDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed()
    };
    service["nextAttesterDuties"].set(0, {...duty, isAggregator: false});
    rpcClientStub.beacon.getFork.resolves({fork: generateFork()});
    rpcClientStub.validator.produceAttestation.resolves(generateEmptyAttestation());
    rpcClientStub.validator.publishAttestation.resolves();
    dbStub.getAttestations.resolves([]);
    dbStub.setAttestation.resolves();
    const promise = service.onNewSlot(0);
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(
      rpcClientStub.validator
        .produceAttestation.withArgs(
          keypair.publicKey.toBytesCompressed(),
          false,
          1,
          1
        ).calledOnce
    ).to.be.true;
    expect(
      rpcClientStub.validator
        .publishAttestation.calledOnce
    ).to.be.true;
    expect(
      dbStub.getAttestations.calledTwice
    ).to.be.true;
    expect(
      dbStub.setAttestation.calledOnce
    ).to.be.true;
  });
  
  it("on  new slot - with duty - conflicting attestation", async function () {
    const  keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(98n, 32)));
    rpcClientStub.beacon = {
      getFork: sinon.stub()
    };
    rpcClientStub.validator = {
      produceAttestation: sinon.stub(),
      publishAttestation: sinon.stub()
    };
    const service = new AttestationService(
      config,
      keypair,
      rpcClientStub,
      dbStub,
      logger
    );
    const duty: ValidatorDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed()
    };
    service["nextAttesterDuties"].set(0, {...duty, isAggregator: false});
    rpcClientStub.beacon.getFork.resolves({fork: generateFork()});
    rpcClientStub.validator.produceAttestation.resolves(
      generateAttestation({
        data: generateAttestationData(0, 1)
      })
    );
    rpcClientStub.validator.publishAttestation.resolves();
    dbStub.getAttestations.resolves([
      {
        data: generateAttestationData(0, 1)
      }
    ]);
    dbStub.setAttestation.resolves();
    const promise = service.onNewSlot(0);
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(
      rpcClientStub.validator
        .produceAttestation.withArgs(
          keypair.publicKey.toBytesCompressed(),
          false,
          1,
          1
        ).calledOnce
    ).to.be.true;
    expect(
      rpcClientStub.validator
        .publishAttestation.notCalled
    ).to.be.true;
  });
});
