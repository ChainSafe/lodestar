import bls from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0} from "@chainsafe/lodestar-types";
import {LodestarEventIterator} from "@chainsafe/lodestar-utils";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptyAttestation,
} from "@chainsafe/lodestar/test/utils/attestation";
import {toHexString} from "@chainsafe/ssz";
import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import {InvalidAttestationError, InvalidAttestationErrorCode, SlashingProtection} from "../../../src";
import {BeaconEventType} from "../../../src/api/interface/events";
import {LocalClock} from "../../../src/api/LocalClock";
import {AttestationService} from "../../../src/services/attestation";
import {mapSecretKeysToValidators} from "../../../src/services/utils";
import {SinonStubbedApi} from "../../utils/apiStub";
import {generateFork} from "../../utils/fork";
import {testLogger} from "../../utils/logger";

const clock = sinon.useFakeTimers({now: Date.now(), shouldAdvanceTime: true, toFake: ["setTimeout"]});

describe("validator attestation service", function () {
  const sandbox = sinon.createSandbox();

  let rpcClientStub: SinonStubbedApi;
  let slashingProtectionStub: sinon.SinonStubbedInstance<SlashingProtection>;
  const logger = testLogger();

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
    rpcClientStub.beacon.state.getStateValidator.resolves(config.types.phase0.ValidatorResponse.defaultValue());
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(function () {
    clock.restore();
  });

  it("on new epoch - no duty", async function () {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    const service = new AttestationService(
      config,
      mapSecretKeysToValidators(secretKeys),
      rpcClientStub,
      slashingProtectionStub,
      logger
    );
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    await service.onClockEpoch({epoch: 1});
    expect(rpcClientStub.validator.getAttesterDuties.withArgs(2, [0]).calledOnce).to.be.true;
  });

  it("on new epoch - with duty", async function () {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    const service = new AttestationService(
      config,
      mapSecretKeysToValidators(secretKeys),
      rpcClientStub,
      slashingProtectionStub,
      logger
    );
    const duty: phase0.AttesterDuty = {
      slot: 1,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: 0,
      pubkey: secretKeys[0].toPublicKey().toBytes(),
    };
    rpcClientStub.validator.getAttesterDuties.resolves([duty]);
    await service.onClockEpoch({epoch: 1});
    expect(rpcClientStub.validator.getAttesterDuties.withArgs(2, [0]).calledOnce).to.be.true;
    expect(rpcClientStub.beacon.state.getFork.calledOnce).to.be.true;
  });

  it("on  new slot - without duty", async function () {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    const service = new AttestationService(
      config,
      mapSecretKeysToValidators(secretKeys),
      rpcClientStub,
      slashingProtectionStub,
      logger
    );
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    await service.onClockSlot({slot: 0});
  });

  it("on new slot - with duty - not aggregator", async function () {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    const service = new AttestationService(
      config,
      mapSecretKeysToValidators(secretKeys),
      rpcClientStub,
      slashingProtectionStub,
      logger
    );
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    sandbox.stub(rpcClientStub.clock, "currentEpoch").get(() => 1);
    await service.start();
    const pubkey = secretKeys[0].toPublicKey().toBytes();
    const duty: phase0.AttesterDuty = {
      slot: 1,
      committeeIndex: 2,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: 0,
      pubkey,
    };
    service["nextAttesterDuties"].set(1, new Map([[toHexString(pubkey), {...duty, isAggregator: false}]]));
    rpcClientStub.beacon.state.getFork.resolves(generateFork());
    rpcClientStub.validator.produceAttestationData.resolves(generateEmptyAttestation().data);
    rpcClientStub.beacon.pool.submitAttestation.resolves();
    slashingProtectionStub.checkAndInsertAttestation.resolves();
    const promise = service.onClockSlot({slot: 1});
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(rpcClientStub.validator.produceAttestationData.withArgs(2, 1).calledOnce).to.be.true;
    expect(rpcClientStub.beacon.pool.submitAttestation.calledOnce).to.be.true;
    expect(slashingProtectionStub.checkAndInsertAttestation.calledOnce).to.be.true;
  });

  it("on new slot - with duty - conflicting attestation", async function () {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    const service = new AttestationService(
      config,
      mapSecretKeysToValidators(secretKeys),
      rpcClientStub,
      slashingProtectionStub,
      logger
    );
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    sandbox.stub(rpcClientStub.clock, "currentEpoch").get(() => 1);
    await service.start();
    const pubkey = secretKeys[0].toPublicKey().toBytes();
    const duty: phase0.AttesterDuty = {
      slot: 1,
      committeeIndex: 3,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: 0,
      pubkey,
    };
    service["nextAttesterDuties"].set(1, new Map([[toHexString(pubkey), {...duty, isAggregator: false}]]));
    rpcClientStub.beacon.state.getFork.resolves(generateFork());

    // Simulate double vote detection
    const attestation1 = generateAttestation({data: generateAttestationData(0, 1)});
    rpcClientStub.validator.produceAttestationData.resolves(attestation1.data);
    rpcClientStub.beacon.pool.submitAttestation.resolves();
    slashingProtectionStub.checkAndInsertAttestation.rejects(
      new InvalidAttestationError({code: InvalidAttestationErrorCode.DOUBLE_VOTE} as any)
    );

    const promise = service.onClockSlot({slot: 1});
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(rpcClientStub.validator.produceAttestationData.withArgs(3, 1).calledOnce).to.be.true;
    expect(rpcClientStub.beacon.pool.submitAttestation.notCalled).to.be.true;
  });

  it("on new slot - with duty - SSE message comes before 1/3 slot time", async function () {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    const service = new AttestationService(
      config,
      mapSecretKeysToValidators(secretKeys),
      rpcClientStub,
      slashingProtectionStub,
      logger
    );
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    sandbox.stub(rpcClientStub.clock, "currentEpoch").get(() => 1);
    await service.start();
    const pubkey = secretKeys[0].toPublicKey().toBytes();
    const duty: phase0.AttesterDuty = {
      slot: 10,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: 0,
      pubkey,
    };
    service["nextAttesterDuties"].set(10, new Map([[toHexString(pubkey), {...duty, isAggregator: false}]]));
    rpcClientStub.beacon.state.getFork.resolves(generateFork());
    rpcClientStub.validator.produceAttestationData.resolves(generateEmptyAttestation().data);
    rpcClientStub.beacon.pool.submitAttestation.resolves();
    slashingProtectionStub.checkAndInsertAttestation.resolves();
    const promise = service.onClockSlot({slot: 10});
    rpcClientStub.emit(BeaconEventType.BLOCK, {block: new Uint8Array(32), slot: 10});
    // don't need to wait for 1/3 slot time which is 4000
    clock.tick(1001);
    await promise;
    expect(rpcClientStub.validator.produceAttestationData.withArgs(1, 10).calledOnce).to.be.true;
  });
});
