import {SinonStub, SinonStubbedInstance} from "sinon";
import {ArrayDagLMDGHOST, BeaconChain, IBeaconChain, ILMDGHOST} from "../../../../src/chain";
import {StubbedBeaconDb} from "../../../utils/stub";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {AttestationProcessor} from "../../../../src/chain/attestation";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon from "sinon";
import {generateAttestation} from "../../../utils/attestation";
import * as attestationProcessMethods from "../../../../src/chain/attestation/processor";
import {expect} from "chai";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {toHexString} from "@chainsafe/ssz";
import {generateBlockSummary, generateSignedBlock} from "../../../utils/block";
import {FAR_FUTURE_EPOCH} from "../../../../src/constants";
import {LocalClock} from "../../../../src/chain/clock/local/LocalClock";
import {Slot} from "@chainsafe/lodestar-types";

describe("attestation pool", function () {
  let chain: SinonStubbedInstance<IBeaconChain>;
  let db: StubbedBeaconDb;
  let forkChoice: SinonStubbedInstance<ILMDGHOST>;
  let processAttestationStub: SinonStub;
  const logger = sinon.createStubInstance(WinstonLogger);

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    forkChoice = sinon.createStubInstance(ArrayDagLMDGHOST);
    chain.forkChoice = forkChoice;
    processAttestationStub = sinon.stub(attestationProcessMethods, "processAttestation");
  });

  afterEach(function () {
    processAttestationStub.restore();
  });

  it("should not receive old attestation", async function () {
    const attestation = generateAttestation({data: {target: {epoch: 0}}});
    chain.getGenesisTime.returns(
      Math.floor(Date.now() / 1000) + 2 * config.params.SLOTS_PER_EPOCH + config.params.SECONDS_PER_SLOT
    );
    const pool = new AttestationProcessor(chain, {config, db, logger});
    await pool.receiveAttestation(attestation);
    expect(processAttestationStub.notCalled).to.be.true;
  });

  it("delay future attestation", async function () {
    const attestation = generateAttestation({data: {target: {epoch: 1}}});
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    const pool = new AttestationProcessor(chain, {config, db, logger});
    await pool.receiveAttestation(attestation);
    expect(
      pool.getPendingSlotAttestations(computeStartSlotAtEpoch(config, attestation.data.target.epoch)).length
    ).to.equal(1);
    expect(processAttestationStub.notCalled).to.be.true;
  });

  it("delay missing block attestation", async function () {
    const attestation = generateAttestation({
      data: {
        beaconBlockRoot: Buffer.alloc(32, 1),
        target: {
          root: Buffer.alloc(32, 2),
        },
      },
    });
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    forkChoice.getBlockSummaryByBlockRoot
      .withArgs(attestation.data.target.root.valueOf() as Uint8Array)
      .returns(generateBlockSummary());
    forkChoice.getBlockSummaryByBlockRoot
      .withArgs(attestation.data.beaconBlockRoot.valueOf() as Uint8Array)
      .returns(null);
    const pool = new AttestationProcessor(chain, {config, db, logger});
    await pool.receiveAttestation(attestation);
    expect(pool.getPendingBlockAttestations(toHexString(attestation.data.beaconBlockRoot)).length).to.equal(1);
    expect(processAttestationStub.notCalled).to.be.true;
  });

  it("delay attestation - wait for current slot to catch up", async function () {
    const attestation = generateAttestation({
      data: {
        slot: 2,
        beaconBlockRoot: Buffer.alloc(32, 1),
        target: {
          root: Buffer.alloc(32, 2),
        },
      },
    });
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    forkChoice.getBlockSummaryByBlockRoot.returns(generateBlockSummary());
    const pool = new AttestationProcessor(chain, {config, db, logger});
    await pool.receiveAttestation(attestation);
    expect(pool.getPendingSlotAttestations(attestation.data.slot + 1).length).to.equal(1);
    expect(processAttestationStub.notCalled).to.be.true;
  });

  it("receive attestation", async function () {
    const attestation = generateAttestation({});
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT);
    forkChoice.getBlockSummaryByBlockRoot.returns(generateBlockSummary());
    const pool = new AttestationProcessor(chain, {config, db, logger});
    processAttestationStub.resolves();
    await pool.receiveAttestation(attestation);
    expect(processAttestationStub.calledOnce).to.be.true;
  });

  it("process pending block attestations", async function () {
    const blockAttestation = generateAttestation({
      data: {
        target: {
          epoch: FAR_FUTURE_EPOCH,
        },
      },
    });
    const block = generateSignedBlock({
      message: {
        body: {
          attestations: [blockAttestation],
        },
      },
    });
    const attestation = generateAttestation({
      data: {
        beaconBlockRoot: config.types.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT);
    forkChoice.getBlockSummaryByBlockRoot
      .withArgs(attestation.data.target.root.valueOf() as Uint8Array)
      .returns(generateBlockSummary());
    const pool = new AttestationProcessor(chain, {config, db, logger});
    await pool.receiveAttestation(attestation);
    const receiveAttestationStub = sinon.stub();
    pool.receiveAttestation = receiveAttestationStub;
    await pool.receiveBlock(block);
    expect(receiveAttestationStub.withArgs(blockAttestation).calledOnce).to.be.true;
    expect(receiveAttestationStub.withArgs(attestation).calledOnce).to.be.true;
    expect(pool.getPendingBlockAttestations(toHexString(attestation.data.beaconBlockRoot)).length).to.equal(0);
  });

  it("process pending slot attestations", async function () {
    const attestation = generateAttestation({
      data: {
        target: {
          epoch: 1,
        },
      },
    });
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    const clock = sinon.createStubInstance(LocalClock);
    chain.clock = clock;
    let newSlotCallback: (slot: Slot) => void;
    clock.onNewSlot.callsFake((callback) => {
      newSlotCallback = callback;
    });
    const pool = new AttestationProcessor(chain, {config, db, logger});
    await pool.receiveAttestation(attestation);
    const receiveAttestationStub = sinon.stub();
    pool.receiveAttestation = receiveAttestationStub;
    await pool.start();
    await newSlotCallback(computeStartSlotAtEpoch(config, attestation.data.target.epoch));
    expect(receiveAttestationStub.withArgs(attestation).calledOnce).to.be.true;
    expect(
      pool.getPendingSlotAttestations(computeStartSlotAtEpoch(config, attestation.data.target.epoch)).length
    ).to.equal(0);
    await pool.stop();
  });
});
