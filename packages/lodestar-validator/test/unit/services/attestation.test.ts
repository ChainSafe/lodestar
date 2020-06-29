import sinon, {SinonSpy} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import {afterEach, beforeEach, describe, it} from "mocha";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import EventSource from "eventsource";
import {ApiClientOverInstance} from "../../../src/api";
import {AttestationService} from "../../../src/services/attestation";
import {toBufferBE} from "bigint-buffer";
import {AttesterDuty} from "@chainsafe/lodestar-types";
import {MockValidatorDB} from "../../utils/mocks/MockValidatorDB";
import {generateFork} from "../../utils/fork";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptyAttestation
} from "@chainsafe/lodestar/test/utils/attestation";
import {generateEmptySignedBlock} from "@chainsafe/lodestar/test/utils/block";

const clock = sinon.useFakeTimers({now: Date.now(), shouldAdvanceTime: true, toFake: ["setTimeout"]});


describe("validator attestation service", function () {

  const sandbox = sinon.createSandbox();

  let rpcClientStub: any, dbStub: any, eventSourceSpy: SinonSpy;
  const logger: ILogger = sinon.createStubInstance(WinstonLogger);


  beforeEach(() => {
    rpcClientStub = sandbox.createStubInstance(ApiClientOverInstance);
    dbStub = sandbox.createStubInstance(MockValidatorDB);
    eventSourceSpy = sandbox.spy(EventSource.prototype, "addEventListener");
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
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 0,
      validatorPubkey: keypair.publicKey.toBytesCompressed()
    };
    rpcClientStub.validator.getAttesterDuties.resolves([duty]);
    rpcClientStub.beacon.getFork.resolves({fork: generateFork()});
    await service.onNewEpoch(1);
    expect(
      rpcClientStub.validator.getAttesterDuties.withArgs(2, [keypair.publicKey.toBytesCompressed()]).calledOnce
    ).to.be.true;
    expect(rpcClientStub.beacon.getFork.calledOnce).to.be.true;
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
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 1,
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
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 1,
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
          1,
          1
        ).calledOnce
    ).to.be.true;
    expect(
      rpcClientStub.validator
        .publishAttestation.notCalled
    ).to.be.true;
  });

  it("on new slot - with duty - SSE message comes before 1/3 slot time", async function () {
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
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed()
    };
    service["nextAttesterDuties"].set(10, {...duty, isAggregator: false});
    rpcClientStub.beacon.getFork.resolves({fork: generateFork()});
    rpcClientStub.validator.produceAttestation.resolves(generateEmptyAttestation());
    rpcClientStub.validator.publishAttestation.resolves();
    dbStub.getAttestations.resolves([]);
    dbStub.setAttestation.resolves();
    const promise = service.onNewSlot(10);
    setTimeout(() => {
      const signedBlock = generateEmptySignedBlock();
      signedBlock.message.slot = 10;
      const eventSource = eventSourceSpy.thisValues[0] as EventSource;
      eventSource.onmessage({
        data: JSON.stringify(config.types.SignedBeaconBlock.toJson(signedBlock, {case: "snake"})),
        lastEventId: "10",
        origin: ""
      } as MessageEvent);
    }, 1000);
    // don't need to wait for 1/3 slot time which is 4000
    clock.tick(1001);
    await promise;
    expect(
      rpcClientStub.validator
        .produceAttestation.withArgs(
          keypair.publicKey.toBytesCompressed(),
          1,
          1
        ).calledOnce
    ).to.be.true;
  });

});
