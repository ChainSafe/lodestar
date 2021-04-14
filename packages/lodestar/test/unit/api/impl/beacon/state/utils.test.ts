import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/minimal";
import {toHexString} from "@chainsafe/ssz";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {
  getEpochBeaconCommittees,
  resolveStateId,
  getValidatorStatus,
} from "../../../../../../src/api/impl/beacon/state/utils";
import {BeaconChain, IBeaconChain} from "../../../../../../src/chain";
import {IBeaconClock} from "../../../../../../src/chain/clock/interface";
import {generateBlockSummary} from "../../../../../utils/block";
import {generateCachedState} from "../../../../../utils/state";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {generateValidators} from "../../../../../utils/validator";
import {PERSIST_STATE_EVERY_EPOCHS} from "../../../../../../src/tasks/tasks/archiveStates";

use(chaiAsPromised);

describe("beacon state api utils", function () {
  describe("resolve state id", function () {
    const dbStub = new StubbedBeaconDb(sinon, config);

    it("resolve head state id - success", async function () {
      const getHead = sinon.stub().returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
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
      const getFinalizedCheckpoint = sinon.stub().returns({root: Buffer.alloc(32, 1), epoch: 1});
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({
        forkChoice: {getFinalizedCheckpoint},
        stateCache: {get},
      } as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, "finalized");
      expect(state).to.not.be.null;
      expect(getFinalizedCheckpoint.calledOnce).to.be.true;
      expect(get.calledOnce).to.be.true;
    });

    it("resolve justified state id - success", async function () {
      const getJustifiedCheckpoint = sinon.stub().returns({root: Buffer.alloc(32, 1), epoch: 1});
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({
        forkChoice: {getJustifiedCheckpoint},
        stateCache: {get},
      } as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, "justified");
      expect(state).to.not.be.null;
      expect(getJustifiedCheckpoint.calledOnce).to.be.true;
      expect(get.calledOnce).to.be.true;
    });

    it("resolve state by root", async function () {
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({stateCache: {get}} as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, toHexString(Buffer.alloc(32, 1)));
      expect(state).to.not.be.null;
      expect(get.calledOnce).to.be.true;
    });

    it("resolve state by slot", async function () {
      const getCanonicalBlockSummaryAtSlot = sinon
        .stub()
        .withArgs(123)
        .returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({
        forkChoice: {getCanonicalBlockSummaryAtSlot},
        stateCache: {get},
      } as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, "123");
      expect(state).to.not.be.null;
      expect(getCanonicalBlockSummaryAtSlot.withArgs(123).calledOnce).to.be.true;
    });

    it("resolve state by on unarchived finalized slot", async function () {
      const nearestArchiveSlot = PERSIST_STATE_EVERY_EPOCHS * config.params.SLOTS_PER_EPOCH;
      const finalizedEpoch = 1028;
      const requestedSlot = 1026 * config.params.SLOTS_PER_EPOCH;

      const getFinalizedCheckpoint = sinon.stub().returns({root: Buffer.alloc(32, 1), epoch: finalizedEpoch});
      const getCanonicalBlockSummaryAtSlot = sinon
        .stub()
        .onSecondCall()
        .returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
      const get = sinon.stub().returns(generateCachedState({slot: nearestArchiveSlot}));
      const chainStub = ({
        forkChoice: {getCanonicalBlockSummaryAtSlot, getFinalizedCheckpoint},
        stateCache: {get},
      } as unknown) as IBeaconChain;
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const valuesStream = sinon.stub().returns({async *[Symbol.asyncIterator]() {}});
      const tempDbStub = {
        blockArchive: {valuesStream},
      } as StubbedBeaconDb;
      const state = await resolveStateId(config, chainStub, tempDbStub, requestedSlot.toString());
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
      expect(status).to.be.equal(phase0.ValidatorStatus.PENDING_INITIALIZED);
    });
    it("should return PENDING_QUEUED", function () {
      const validator = {
        activationEpoch: 1,
        activationEligibilityEpoch: 101010101101010,
      } as phase0.Validator;
      const currentEpoch = 0;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.PENDING_QUEUED);
    });
    it("should return ACTIVE_ONGOING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: Infinity,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.ACTIVE_ONGOING);
    });
    it("should return ACTIVE_SLASHED", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: true,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.ACTIVE_SLASHED);
    });
    it("should return ACTIVE_EXITING", function () {
      const validator = {
        activationEpoch: 1,
        exitEpoch: 101010101101010,
        slashed: false,
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.ACTIVE_EXITING);
    });
    it("should return EXITED_SLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: true,
      } as phase0.Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.EXITED_SLASHED);
    });
    it("should return EXITED_UNSLASHED", function () {
      const validator = {
        exitEpoch: 1,
        withdrawableEpoch: 3,
        slashed: false,
      } as phase0.Validator;
      const currentEpoch = 2;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.EXITED_UNSLASHED);
    });
    it("should return WITHDRAWAL_POSSIBLE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: BigInt(32),
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.WITHDRAWAL_POSSIBLE);
    });
    it("should return WITHDRAWAL_DONE", function () {
      const validator = {
        withdrawableEpoch: 1,
        effectiveBalance: BigInt(0),
      } as phase0.Validator;
      const currentEpoch = 1;
      const status = getValidatorStatus(validator, currentEpoch);
      expect(status).to.be.equal(phase0.ValidatorStatus.WITHDRAWAL_DONE);
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
    let chainStub: SinonStubbedInstance<IBeaconChain>;

    beforeEach(function () {
      chainStub = sinon.createStubInstance(BeaconChain);
    });

    it("current epoch with epoch context", function () {
      chainStub.clock = {
        currentEpoch: 1,
      } as IBeaconClock;
      const state = generateCachedState({}, config);
      const committees = getEpochBeaconCommittees(config, chainStub, state, 1);
      expect(committees).to.be.deep.equal(state.currentShuffling.committees);
    });

    it("previous epoch with epoch context", function () {
      chainStub.clock = {
        currentEpoch: 2,
      } as IBeaconClock;
      const state = generateCachedState({}, config);
      const committees = getEpochBeaconCommittees(config, chainStub, state, 1);
      expect(committees).to.be.deep.equal(state.previousShuffling.committees);
    });

    it("old/new epoch with epoch context", function () {
      chainStub.clock = {
        currentEpoch: 3,
      } as IBeaconClock;
      const state = generateCachedState(
        {
          validators: generateValidators(24, {activationEpoch: 0, exitEpoch: 10}),
        },
        config
      );
      const committees = getEpochBeaconCommittees(config, chainStub, state, 1);
      expect(committees[0][0][0]).to.not.be.undefined;
    });
  });
});
