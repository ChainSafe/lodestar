import {computeStartSlotAtEpoch, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/default";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {
  getEpochBeaconCommittees,
  resolveStateId,
  getValidatorStatus,
} from "../../../../../../src/api/impl/beacon/state/utils";
import {IBeaconChain} from "../../../../../../src/chain";
import {PERSIST_STATE_EVERY_EPOCHS} from "../../../../../../src/chain/archiver/archiveStates";
import {generateProtoBlock} from "../../../../../utils/block";
import {generateCachedState, generateState} from "../../../../../utils/state";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {generateValidators} from "../../../../../utils/validator";

use(chaiAsPromised);

describe("beacon state api utils", function () {
  describe("resolve state id", function () {
    const dbStub = new StubbedBeaconDb(config);
    const otherRoot = toHexString(Buffer.alloc(32, 1));

    it("resolve head state id - success", async function () {
      const getHead = sinon.stub().returns(generateProtoBlock({stateRoot: otherRoot}));
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({
        forkChoice: {getHead},
        stateCache: {get},
      } as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, "head");
      expect(state).to.not.be.null;
      expect(getHead.calledOnce).to.be.true;
      expect(get.calledOnce).to.be.true;
    });

    it("resolve finalized state id - success", async function () {
      const getFinalizedBlock = sinon.stub().returns(generateProtoBlock());
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({
        forkChoice: {getFinalizedBlock},
        stateCache: {get},
      } as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, "finalized");
      expect(state).to.not.be.null;
      expect(getFinalizedBlock.calledOnce).to.be.true;
      expect(get.calledOnce).to.be.true;
    });

    it("resolve justified state id - success", async function () {
      const getJustifiedBlock = sinon.stub().returns(generateProtoBlock());
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({
        forkChoice: {getJustifiedBlock},
        stateCache: {get},
      } as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, "justified");
      expect(state).to.not.be.null;
      expect(getJustifiedBlock.calledOnce).to.be.true;
      expect(get.calledOnce).to.be.true;
    });

    it("resolve state by root", async function () {
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({stateCache: {get}} as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, otherRoot);
      expect(state).to.not.be.null;
      expect(get.calledOnce).to.be.true;
    });

    it("resolve state by slot", async function () {
      const getCanonicalBlockAtSlot = sinon
        .stub()
        .withArgs(123)
        .returns(generateProtoBlock({stateRoot: otherRoot}));
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({
        forkChoice: {getCanonicalBlockAtSlot},
        stateCache: {get},
      } as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, "123");
      expect(state).to.not.be.null;
      expect(getCanonicalBlockAtSlot.withArgs(123).calledOnce).to.be.true;
    });

    it("resolve state on unarchived finalized slot", async function () {
      const nearestArchiveSlot = PERSIST_STATE_EVERY_EPOCHS * SLOTS_PER_EPOCH;
      const finalizedEpoch = 1028;
      const requestedSlot = 1026 * SLOTS_PER_EPOCH;

      const getFinalizedCheckpoint = sinon.stub().returns({root: Buffer.alloc(32, 1), epoch: finalizedEpoch});
      const getCanonicalBlockAtSlot = sinon
        .stub()
        .onSecondCall()
        .returns(generateProtoBlock({stateRoot: otherRoot}));
      const chainStub = ({
        forkChoice: {getCanonicalBlockAtSlot, getFinalizedCheckpoint},
      } as unknown) as IBeaconChain;
      const nearestState = generateState({slot: nearestArchiveSlot});
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const blockArchiveValuesStream = sinon.stub().returns({async *[Symbol.asyncIterator]() {}});
      const stateArchiveValuesStream = sinon.stub().returns({
        async *[Symbol.asyncIterator]() {
          yield nearestState;
        },
      });
      const get = sinon.stub().returns(nearestState);
      const tempDbStub = {
        blockArchive: {valuesStream: blockArchiveValuesStream},
        stateArchive: {get, valuesStream: stateArchiveValuesStream},
      } as StubbedBeaconDb;
      const state = await resolveStateId(config, chainStub, tempDbStub, requestedSlot.toString(), {
        regenFinalizedState: true,
      });
      expect(state).to.not.be.null;
      expect(state?.slot).to.be.equal(requestedSlot);
    });
  });

  describe("getValidatorStatus", function () {
    it("should return PENDING_INITIALIZED", function () {
      const validator = {
        activationEpoch: 1,
        activationEligibilityEpoch: Infinity,
      } as phase0.Validator;
      const currentEpoch = 0;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("pending_initialized");
    });
    it("should return PENDING_QUEUED", function () {
      const validator = {
        activationEpoch: 1,
        activationEligibilityEpoch: 101010101101010,
      } as phase0.Validator;
      const currentEpoch = 0;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("pending_queued");
    });
    it("should return ACTIVE_ONGOING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: Infinity,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("active_ongoing");
    });
    it("should return ACTIVE_SLASHED", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: true,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("active_slashed");
    });
    it("should return ACTIVE_EXITING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: false,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("active_exiting");
    });
    it("should return EXITED_SLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: true,
      } as phase0.Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("exited_slashed");
    });
    it("should return EXITED_UNSLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: false,
      } as phase0.Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("exited_unslashed");
    });
    it("should return WITHDRAWAL_POSSIBLE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: 32,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("withdrawal_possible");
    });
    it("should return WITHDRAWAL_DONE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: 0,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal("withdrawal_done");
    });
    it("should error", function () {
      const validator = {} as phase0.Validator;
      const currentEpoch = 0;
      try {
        getValidatorStatus(validator, currentEpoch);
      } catch (error) {
        expect(error).to.have.property("message", "ValidatorStatus unknown");
      }
    });
  });

  describe("getEpochBeaconCommittees", function () {
    it("current epoch with epoch context", function () {
      const state = generateCachedState({}, config);
      state.slot = computeStartSlotAtEpoch(1);
      const committees = getEpochBeaconCommittees(state, 1);
      expect(committees).to.be.deep.equal(state.currentShuffling.committees);
    });

    it("previous epoch with epoch context", function () {
      const state = generateCachedState({}, config);
      state.slot = computeStartSlotAtEpoch(2);
      const committees = getEpochBeaconCommittees(state, 1);
      expect(committees).to.be.deep.equal(state.previousShuffling.committees);
    });

    it("old/new epoch with epoch context", function () {
      const state = generateCachedState(
        {validators: generateValidators(24, {activationEpoch: 0, exitEpoch: 10})},
        config
      );
      state.slot = computeStartSlotAtEpoch(3);
      const committees = getEpochBeaconCommittees(state, 1);
      expect(committees[0][0][0]).to.not.be.undefined;
    });
  });
});
