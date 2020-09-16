import {resolveStateId} from "../../../../../../src/api/impl/beacon/state/utils";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import sinon, {SinonStubbedInstance} from "sinon";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {generateState} from "../../../../../utils/state";
import {expect, use} from "chai";
import {toHexString} from "@chainsafe/ssz";
import chaiAsPromised from "chai-as-promised";
import {generateBlockSummary} from "../../../../../utils/block";

use(chaiAsPromised);

describe("beacon state api utils", function () {
  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sinon, config);
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
  });

  it("resolve head state id - success", async function () {
    forkChoiceStub.getHead.returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
    dbStub.stateCache.get.resolves({state: generateState(), epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, "head");
    expect(state).to.not.be.null;
    expect(forkChoiceStub.getHead.calledOnce).to.be.true;
    expect(dbStub.stateCache.get.calledOnce).to.be.true;
  });

  it("resolve genesis state id - success", async function () {
    dbStub.stateArchive.get.withArgs(0).resolves(generateState());
    const state = await resolveStateId(config, dbStub, forkChoiceStub, "genesis");
    expect(state).to.not.be.null;
    expect(dbStub.stateArchive.get.withArgs(0).calledOnce).to.be.true;
  });

  it("resolve finalized state id - success", async function () {
    forkChoiceStub.getFinalizedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
    dbStub.stateCache.get.resolves({state: generateState(), epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, "finalized");
    expect(state).to.not.be.null;
    expect(forkChoiceStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.stateCache.get.calledOnce).to.be.true;
  });

  it("resolve finalized state id - missing state", async function () {
    forkChoiceStub.getFinalizedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
    dbStub.stateCache.get.resolves({state: null!, epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, "finalized");
    expect(state).to.be.null;
    expect(forkChoiceStub.getFinalizedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.stateCache.get.calledOnce).to.be.true;
  });

  it("resolve justified state id - success", async function () {
    forkChoiceStub.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
    dbStub.stateCache.get.resolves({state: generateState(), epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, "justified");
    expect(state).to.not.be.null;
    expect(forkChoiceStub.getJustifiedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.stateCache.get.calledOnce).to.be.true;
  });

  it("resolve justified state id - missing state", async function () {
    forkChoiceStub.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
    dbStub.stateCache.get.resolves({state: null!, epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, "justified");
    expect(state).to.be.null;
    expect(forkChoiceStub.getJustifiedCheckpoint.calledOnce).to.be.true;
    expect(dbStub.stateCache.get.calledOnce).to.be.true;
  });

  it("resolve state by root", async function () {
    dbStub.stateCache.get.resolves({state: generateState(), epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, toHexString(Buffer.alloc(32, 1)));
    expect(state).to.not.be.null;
    expect(dbStub.stateCache.get.calledOnce).to.be.true;
  });

  it.skip("resolve finalized state by root", async function () {
    dbStub.stateCache.get.resolves({state: generateState(), epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, toHexString(Buffer.alloc(32, 1)));
    expect(state).to.be.null;
    expect(dbStub.stateCache.get.calledOnce).to.be.true;
  });

  it("state id is invalid root", async function () {
    await expect(resolveStateId(config, dbStub, forkChoiceStub, "adcas")).to.be.eventually.rejected;
    expect(dbStub.stateCache.get.notCalled).to.be.true;
  });

  it("resolve state by slot", async function () {
    forkChoiceStub.getCanonicalBlockSummaryAtSlot
      .withArgs(123)
      .returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
    dbStub.stateCache.get.resolves({state: generateState(), epochCtx: null!});
    const state = await resolveStateId(config, dbStub, forkChoiceStub, "123");
    expect(state).to.not.be.null;
    expect(forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(123).calledOnce).to.be.true;
  });
});
