import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Keypair, PrivateKey} from "@chainsafe/bls";
import EventSource from "eventsource";
import {AttestationService} from "../../../src/services/attestation";
import {toBufferBE} from "bigint-buffer";
import {AttesterDuty} from "@chainsafe/lodestar-types";
import {MockValidatorDB} from "../../utils/mocks/MockValidatorDB";
import {generateFork} from "../../utils/fork";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptyAttestation,
} from "@chainsafe/lodestar/test/utils/attestation";
import {silentLogger} from "../../utils/logger";
import {SinonStubbedBeaconApi} from "../../utils/apiStub";
import {LodestarEventIterator} from "@chainsafe/lodestar-utils";
import {BeaconEventType} from "../../../src/api/impl/rest/events/types";

const clock = sinon.useFakeTimers({now: Date.now(), shouldAdvanceTime: true, toFake: ["setTimeout"]});

describe("validator attestation service", function () {
  const sandbox = sinon.createSandbox();

  let rpcClientStub: SinonStubbedBeaconApi, dbStub: any;
  const logger = silentLogger;

  beforeEach(() => {
    rpcClientStub = new SinonStubbedBeaconApi(sandbox);
    rpcClientStub.beacon.getFork.resolves({
      fork: generateFork(),
      chainId: BigInt(2),
      genesisValidatorsRoot: Buffer.alloc(32, 0),
    });
    rpcClientStub.events.getEventStream.returns(
      new LodestarEventIterator(() => {
        return;
      })
    );
    dbStub = sandbox.createStubInstance(MockValidatorDB);
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(function () {
    clock.restore();
  });

  it("on new epoch - no duty", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, dbStub, logger);
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    await service.onNewEpoch(1);
    expect(rpcClientStub.validator.getAttesterDuties.withArgs(2, [keypair.publicKey.toBytesCompressed()]).calledOnce).to
      .be.true;
  });

  it("on new epoch - with duty", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, dbStub, logger);
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 0,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    rpcClientStub.validator.getAttesterDuties.resolves([duty]);
    await service.onNewEpoch(1);
    expect(rpcClientStub.validator.getAttesterDuties.withArgs(2, [keypair.publicKey.toBytesCompressed()]).calledOnce).to
      .be.true;
    expect(rpcClientStub.beacon.getFork.calledOnce).to.be.true;
  });

  it("on  new slot - without duty", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, dbStub, logger);
    rpcClientStub.validator.getAttesterDuties.resolves([]);
    await service.onNewSlot(0);
  });

  it("on  new slot - with duty - not aggregator", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, dbStub, logger);
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    service["nextAttesterDuties"].set(1, [{...duty, attesterIndex: 0, isAggregator: false}]);
    rpcClientStub.beacon.getFork.resolves({
      fork: generateFork(),
      chainId: BigInt(2),
      genesisValidatorsRoot: Buffer.alloc(32, 0),
    });
    rpcClientStub.validator.produceAttestation.resolves(generateEmptyAttestation());
    rpcClientStub.validator.publishAttestation.resolves();
    dbStub.getAttestations.resolves([]);
    dbStub.setAttestation.resolves();
    const promise = service.onNewSlot(1);
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(rpcClientStub.validator.produceAttestation.withArgs(sinon.match.any, 1, 1).calledOnce).to.be.true;
    expect(rpcClientStub.validator.publishAttestation.calledOnce).to.be.true;
    expect(dbStub.getAttestations.calledTwice).to.be.true;
    expect(dbStub.setAttestation.calledOnce).to.be.true;
  });

  it("on  new slot - with duty - conflicting attestation", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, dbStub, logger);
    const duty: AttesterDuty = {
      attestationSlot: 1,
      committeeIndex: 1,
      aggregatorModulo: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    service["nextAttesterDuties"].set(1, [{...duty, attesterIndex: 0, isAggregator: false}]);
    rpcClientStub.beacon.getFork.resolves({
      fork: generateFork(),
      chainId: BigInt(2),
      genesisValidatorsRoot: Buffer.alloc(32, 0),
    });
    rpcClientStub.validator.produceAttestation.resolves(
      generateAttestation({
        data: generateAttestationData(0, 1),
      })
    );
    rpcClientStub.validator.publishAttestation.resolves();
    dbStub.getAttestations.resolves([
      {
        data: generateAttestationData(0, 1),
      },
    ]);
    dbStub.setAttestation.resolves();
    const promise = service.onNewSlot(1);
    clock.tick(4000);
    await Promise.resolve(promise);
    expect(rpcClientStub.validator.produceAttestation.withArgs(keypair.publicKey.toBytesCompressed(), 1, 1).calledOnce)
      .to.be.true;
    expect(rpcClientStub.validator.publishAttestation.notCalled).to.be.true;
  });

  it("on new slot - with duty - SSE message comes before 1/3 slot time", async function () {
    const keypair = new Keypair(PrivateKey.fromBytes(toBufferBE(BigInt(98), 32)));
    const service = new AttestationService(config, [keypair], rpcClientStub, dbStub, logger);
    const duty: AttesterDuty = {
      attestationSlot: 10,
      committeeIndex: 1,
      aggregatorModulo: 1,
      validatorPubkey: keypair.publicKey.toBytesCompressed(),
    };
    service["nextAttesterDuties"].set(10, [{...duty, attesterIndex: 0, isAggregator: false}]);
    rpcClientStub.beacon.getFork.resolves({
      fork: generateFork(),
      chainId: BigInt(2),
      genesisValidatorsRoot: Buffer.alloc(32, 0),
    });
    rpcClientStub.validator.produceAttestation.resolves(generateEmptyAttestation());
    rpcClientStub.validator.publishAttestation.resolves();
    dbStub.getAttestations.resolves([]);
    dbStub.setAttestation.resolves();
    rpcClientStub.events.getEventStream.returns(
      new LodestarEventIterator(({push}) => {
        setTimeout(() => {
          push({
            type: BeaconEventType.BLOCK,
            message: {
              block: Buffer.alloc(32, 0),
              slot: 10,
            },
          });
        }, 500);
      })
    );
    const promise = service.onNewSlot(10);
    // don't need to wait for 1/3 slot time which is 4000
    clock.tick(1001);
    await promise;
    expect(rpcClientStub.validator.produceAttestation.withArgs(sinon.match.any, 1, 10).calledOnce).to.be.true;
  });
});
