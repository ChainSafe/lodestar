import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/minimal";
import {Validator, ValidatorStatus} from "@chainsafe/lodestar-types";
import {List, toHexString} from "@chainsafe/ssz";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {ApiStateContext} from "../../../../../../src/api/impl/beacon/state/interface";
import {
  getEpochBeaconCommittees,
  resolveStateId,
  getValidatorStatus,
} from "../../../../../../src/api/impl/beacon/state/utils";
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
      chainStub.stateCache.get.returns({state: generateCachedState(), epochCtx: null!});
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
      chainStub.stateCache.get.returns({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, "finalized");
      expect(state).to.not.be.null;
      expect(chainStub.forkChoice.getFinalizedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve finalized state id - missing state", async function () {
      chainStub.forkChoice.getFinalizedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      chainStub.stateCache.get.returns(null);
      const state = await resolveStateId(chainStub, dbStub, "finalized");
      expect(state).to.be.null;
      expect(chainStub.forkChoice.getFinalizedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve justified state id - success", async function () {
      chainStub.forkChoice.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      chainStub.stateCache.get.returns({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, "justified");
      expect(state).to.not.be.null;
      expect(chainStub.forkChoice.getJustifiedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve justified state id - missing state", async function () {
      chainStub.forkChoice.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      chainStub.stateCache.get.returns(null);
      const state = await resolveStateId(chainStub, dbStub, "justified");
      expect(state).to.be.null;
      expect(chainStub.forkChoice.getJustifiedCheckpoint.calledOnce).to.be.true;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve state by root", async function () {
      chainStub.stateCache.get.returns({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, toHexString(Buffer.alloc(32, 1)));
      expect(state).to.not.be.null;
      expect(chainStub.stateCache.get.calledOnce).to.be.true;
    });

    it.skip("resolve finalized state by root", async function () {
      chainStub.stateCache.get.returns({state: generateCachedState(), epochCtx: null!});
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
      chainStub.stateCache.get.returns({state: generateCachedState(), epochCtx: null!});
      const state = await resolveStateId(chainStub, dbStub, "123");
      expect(state).to.not.be.null;
      expect(chainStub.forkChoice.getCanonicalBlockSummaryAtSlot.withArgs(123).calledOnce).to.be.true;
    });
  });

  describe("getValidatorStatus", function () {
    it("should return PENDING_INITIALIZED", function () {
      const validator = {
        activationEpoch: 1,
        activationEligibilityEpoch: Infinity,
      } as Validator;
      const currentEpoch = 0;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.PENDING_INITIALIZED);
    });
    it("should return PENDING_QUEUED", function () {
      const validator = {
        activationEpoch: 1,
        activationEligibilityEpoch: 101010101101010,
      } as Validator;
      const currentEpoch = 0;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.PENDING_QUEUED);
    });
    it("should return ACTIVE_ONGOING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: Infinity,
      } as Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.ACTIVE_ONGOING);
    });
    it("should return ACTIVE_SLASHED", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: true,
      } as Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.ACTIVE_SLASHED);
    });
    it("should return ACTIVE_EXITING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: false,
      } as Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.ACTIVE_EXITING);
    });
    it("should return EXITED_SLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: true,
      } as Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.EXITED_SLASHED);
    });
    it("should return EXITED_UNSLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: false,
      } as Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.EXITED_UNSLASHED);
    });
    it("should return WITHDRAWAL_POSSIBLE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: BigInt(32),
      } as Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.WITHDRAWAL_POSSIBLE);
    });
    it("should return WITHDRAWAL_DONE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: BigInt(0),
      } as Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(ValidatorStatus.WITHDRAWAL_DONE);
    });
    it("should error", function () {
      const validator = {} as Validator;
      const currentEpoch = 0;
      try {
        getValidatorStatus(validator, currentEpoch);
      } catch (error) {
        expect(error).to.have.property("message", "ValidatorStatus unknown");
      }
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
          } as phase0.fast.IEpochShuffling,
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
          } as phase0.fast.IEpochShuffling,
        } as phase0.EpochContext,
      };
    }
  });
});
