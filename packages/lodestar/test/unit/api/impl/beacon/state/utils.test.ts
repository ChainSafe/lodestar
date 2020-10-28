import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IEpochShuffling} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/epochShuffling";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {Validator} from "@chainsafe/lodestar-types";
import {List, toHexString} from "@chainsafe/ssz";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {ApiStateContext} from "../../../../../../src/api/impl/beacon/state/interface";
import {getEpochBeaconCommittees, resolveStateId} from "../../../../../../src/api/impl/beacon/state/utils";
import {BeaconChain, IBeaconChain} from "../../../../../../src/chain";
import {IBeaconClock} from "../../../../../../src/chain/clock/interface";
import {generateBlockSummary} from "../../../../../utils/block";
import {generateState} from "../../../../../utils/state";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {generateValidator} from "../../../../../utils/validator";

use(chaiAsPromised);

describe("beacon state api utils", function () {
  describe("resolve state id", function () {
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

  describe("getEpochBeaconCommittees", function () {
    let chainStub: SinonStubbedInstance<IBeaconChain>;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
    });

    it("current epoch with epoch context", function () {
      chainStub.clock = {
        currentEpoch: 1,
      } as IBeaconClock;
      const stateContext = getApiContext();
      const committees = getEpochBeaconCommittees(config, chainStub, stateContext, 1);
      expect(committees).to.be.deep.equal(stateContext.epochCtx?.currentShuffling.committees);
    });

    it("previous epoch with epoch context", function () {
      chainStub.clock = {
        currentEpoch: 2,
      } as IBeaconClock;
      const stateContext = getApiContext();
      const committees = getEpochBeaconCommittees(config, chainStub, stateContext, 1);
      expect(committees).to.be.deep.equal(stateContext.epochCtx?.previousShuffling.committees);
    });

    it("old/new epoch with epoch context", function () {
      chainStub.clock = {
        currentEpoch: 3,
      } as IBeaconClock;
      const stateContext = getApiContext();
      stateContext.state = generateState({
        slot: 0,
        validators: Array.from({length: 20}, () => generateValidator({activationEpoch: 1})) as List<Validator>,
      });
      const committees = getEpochBeaconCommittees(config, chainStub, stateContext, 1);
      expect(committees[0][0][0]).to.not.be.undefined;
    });

    it("no epoch context", function () {
      chainStub.clock = {
        currentEpoch: 1,
      } as IBeaconClock;
      const stateContext = getApiContext();
      stateContext.state = generateState({
        slot: 0,
        validators: Array.from({length: 20}, () => generateValidator({activationEpoch: 1})) as List<Validator>,
      });
      const committees = getEpochBeaconCommittees(config, chainStub, stateContext, 1);
      expect(committees[0][0][0]).to.not.be.undefined;
    });

    function getApiContext(): ApiStateContext {
      return {
        state: generateState(),
        epochCtx: {
          currentShuffling: {
            committees: [
              [
                [2, 5, 6],
                [7, 19, 21],
              ],
              [
                [1, 3, 4],
                [8, 12, 22],
              ],
            ],
          } as IEpochShuffling,
          previousShuffling: {
            committees: [
              [
                [1, 2, 4],
                [7, 19, 21],
              ],
              [
                [1, 5, 9],
                [8, 12, 22],
              ],
            ],
          } as IEpochShuffling,
        } as EpochContext,
      };
    }
  });
});
