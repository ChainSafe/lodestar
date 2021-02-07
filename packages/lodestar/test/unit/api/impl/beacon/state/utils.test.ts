import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IEpochShuffling} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/epochShuffling";
import {config} from "@chainsafe/lodestar-config/minimal";
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
import {generateCachedState, generateState} from "../../../../../utils/state";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {StubbedBeaconChain} from "../../../../../utils/stub/chain";
import {generateValidator} from "../../../../../utils/validator";

use(chaiAsPromised);

describe("beacon state api utils", function () {
  describe("resolve state id", function () {
    let dbStub: StubbedBeaconDb;
    let chainStub: StubbedBeaconChain;

    beforeEach(function () {
      dbStub = new StubbedBeaconDb(sinon, config);
      chainStub = new StubbedBeaconChain(sinon, config);
    });

    it("resolve head state id - success", async function () {
      chainStub.forkChoice.getHead.returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
      chainStub.stateCache.get.resolves({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, "head");
      expect(state).to.not.be.null;
      expect(chainStub.forkChoice.getHead.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve genesis state id - success", async function () {
      dbStub.stateArchive.get.withArgs(0).resolves(generateState());
      const state = await resolveStateId(chainStub, dbStub, "genesis");
      expect(state).to.not.be.null;
      expect(dbStub.stateArchive.get.withArgs(0).calledOnce).to.be.true;
    });

    it("resolve finalized state id - success", async function () {
      chainStub.forkChoice.getFinalizedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      chainStub.stateCache.get.resolves({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, "finalized");
      expect(state).to.not.be.null;
      expect(chainStub.forkChoice.getFinalizedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve finalized state id - missing state", async function () {
      chainStub.forkChoice.getFinalizedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      chainStub.stateCache.get.resolves(null);
      const state = await resolveStateId(chainStub, dbStub, "finalized");
      expect(state).to.be.null;
      expect(chainStub.forkChoice.getFinalizedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve justified state id - success", async function () {
      chainStub.forkChoice.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      chainStub.stateCache.get.resolves({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, "justified");
      expect(state).to.not.be.null;
      expect(chainStub.forkChoice.getJustifiedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve justified state id - missing state", async function () {
      chainStub.forkChoice.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      chainStub.stateCache.get.resolves(null);
      const state = await resolveStateId(chainStub, dbStub, "justified");
      expect(state).to.be.null;
      expect(chainStub.forkChoice.getJustifiedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve state by root", async function () {
      chainStub.stateCache.get.resolves({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, toHexString(Buffer.alloc(32, 1)));
      expect(state).to.not.be.null;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it.skip("resolve finalized state by root", async function () {
      chainStub.stateCache.get.resolves({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, toHexString(Buffer.alloc(32, 1)));
      expect(state).to.be.null;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("state id is invalid root", async function () {
      await expect(resolveStateId(chainStub, dbStub, "adcas")).to.be.eventually.rejected;
      expect(chainStub.stateCache.get.notCalled).to.be.true;
    });

    it("resolve state by slot", async function () {
      chainStub.forkChoice.getCanonicalBlockSummaryAtSlot
        .withArgs(123)
        .returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
      chainStub.stateCache.get.resolves({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, "123");
      expect(state).to.not.be.null;
      expect(chainStub.forkChoice.getCanonicalBlockSummaryAtSlot.withArgs(123).calledOnce).to.be.true;
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
        validators: Array.from({length: 24}, () => generateValidator({activationEpoch: 0, exitEpoch: 10})) as List<
          Validator
        >,
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
        state: generateCachedState(),
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
