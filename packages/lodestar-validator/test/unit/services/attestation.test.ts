import {Keypair, PrivateKey} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {AttesterDuty} from "@chainsafe/lodestar-types";
import {LodestarEventIterator} from "@chainsafe/lodestar-utils";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptyAttestation,
} from "@chainsafe/lodestar/test/utils/attestation";
import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import {InvalidAttestationError, InvalidAttestationErrorCode, SlashingProtection} from "../../../src";
import {BeaconEventType} from "../../../src/api/interface/events";
import {LocalClock} from "../../../src/api/LocalClock";
import {AttestationService} from "../../../src/services/attestation";
import {SinonStubbedApi} from "../../utils/apiStub";
import {generateFork} from "../../utils/fork";
import {silentLogger} from "../../utils/logger";

const clock = sinon.useFakeTimers({now: Date.now(), shouldAdvanceTime: true, toFake: ["setTimeout"]});

describe("validator attestation service", function () {
  const sandbox = sinon.createSandbox();

  let rpcClientStub: SinonStubbedApi;
  let slashingProtectionStub: sinon.SinonStubbedInstance<SlashingProtection>;
  const logger = silentLogger;

  beforeEach(() => {
    rpcClientStub = new SinonStubbedApi(sandbox);
    rpcClientStub.clock = sandbox.createStubInstance(LocalClock);
    rpcClientStub.beacon.state.getFork.resolves(generateFork());
    rpcClientStub.events.getEventStream.returns(
      new LodestarEventIterator(() => {
        return;
      })
    );
    slashingProtectionStub = sandbox.createStubInstance(SlashingProtection);
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(function () {
    clock.restore();
  });

  it("on new epoch - no duty", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    await service.onClockEpoch({epoch: 1});
    expect(rpcClientStub.validator.getAttesterDuties.withArgs(2, [keypair.publicKey.toBytesCompressed()]).calledOnce).to
      .be.true;
  });

  it("on new epoch - with duty", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 0,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    rpcClientStub.validator.getAttesterDuties.resolves([duty]);
    await service.onClockEpoch({epoch: 1});
    expect(rpcClientStub.validator.getAttesterDuties.withArgs(2, [keypair.publicKey.toBytesCompressed()]).calledOnce).to
      .be.true;
    expect(rpcClientStub.beacon.state.getFork.calledOnce).to.be.true;
  });

  it("on  new slot - without duty", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    await service.onClockSlot({slot: 0});
  });

  it("on  new slot - with duty - not aggregator", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    sandbox.stub(rpcClientStub.clock, "currentEpoch").get(() => 1);
    await service.start();
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    service["nextAttesterDuties"].set(1, new Map([[0, {...duty, attesterIndex: 0, isAggregator: false}]]));
    rpcClientStub.beacon.state.getFork.resolves(generateFork());
    rpcClientStub.validator.produceAttestation.resolves(generateEmptyAttestation());
    rpcClientStub.validator.publishAttestation.resolves();
    slashingProtectionStub.checkAndInsertAttestation.resolves();
    const promise = service.onClockSlot({slot: 1});
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(rpcClientStub.validator.produceAttestation.withArgs(sinon.match.any, 1, 1).calledOnce).to.be.true;
    expect(rpcClientStub.validator.publishAttestation.calledOnce).to.be.true;
    expect(slashingProtectionStub.checkAndInsertAttestation.calledOnce).to.be.true;
  });

  it("on  new slot - with duty - conflicting attestation", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    sandbox.stub(rpcClientStub.clock, "currentEpoch").get(() => 1);
    await service.start();
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    service["nextAttesterDuties"].set(1, new Map([[0, {...duty, attesterIndex: 0, isAggregator: false}]]));
    rpcClientStub.beacon.state.getFork.resolves(generateFork());

    // Simulate double vote detection
    const attestation1 = generateAttestation({data: generateAttestationData(0, 1)});
    rpcClientStub.validator.produceAttestation.resolves(attestation1);
    rpcClientStub.validator.publishAttestation.resolves();
    slashingProtectionStub.checkAndInsertAttestation.rejects(
      new InvalidAttestationError({code: InvalidAttestationErrorCode.DOUBLE_VOTE} as any)
    );

    const promise = service.onClockSlot({slot: 1});
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(rpcClientStub.validator.produceAttestation.withArgs(keypair.publicKey.toBytesCompressed(), 1, 1).calledOnce)
      .to.be.true;
    expect(rpcClientStub.validator.publishAttestation.notCalled).to.be.true;
  });

  it("on new slot - with duty - SSE message comes before 1/3 slot time", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    sandbox.stub(rpcClientStub.clock, "currentEpoch").get(() => 1);
    await service.start();
    const duty: AttesterDuty = {
      attestationSlot: 10,
      committeeIndex: 1,
      aggregatorModulo: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    service["nextAttesterDuties"].set(10, new Map([[0, {...duty, attesterIndex: 0, isAggregator: false}]]));
    rpcClientStub.beacon.state.getFork.resolves(generateFork());
    rpcClientStub.validator.produceAttestation.resolves(generateEmptyAttestation());
    rpcClientStub.validator.publishAttestation.resolves();
    slashingProtectionStub.checkAndInsertAttestation.resolves();
    const promise = service.onClockSlot({slot: 10});
    rpcClientStub.emit(BeaconEventType.BLOCK, {block: new Uint8Array(32), slot: 10});
    // don't need to wait for 1/3 slot time which is 4000
    clock.tick(1001);
    await promise;
    expect(rpcClientStub.validator.produceAttestation.withArgs(sinon.match.any, 1, 10).calledOnce).to.be.true;
  });
});
