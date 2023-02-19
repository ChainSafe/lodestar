import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {phase0} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {
  resolveStateId,
  getValidatorStatus,
  getStateValidatorIndex,
} from "../../../../../../src/api/impl/beacon/state/utils.js";
import {IBeaconChain} from "../../../../../../src/chain/index.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";
import {generateCachedAltairState, generateCachedState, generateState} from "../../../../../utils/state.js";
import {StubbedBeaconDb} from "../../../../../utils/stub/index.js";

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
      expect(getHead).to.be.calledOnce;
      expect(get).to.be.calledOnce;
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
      expect(getFinalizedBlock).to.be.calledOnce;
      expect(get).to.be.calledOnce;
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
      expect(getJustifiedBlock).to.be.calledOnce;
      expect(get).to.be.calledOnce;
    });

    it("resolve state by root", async function () {
      const get = sinon.stub().returns(generateCachedState());
      const chainStub = ({stateCache: {get}, forkChoice: {getBlock: sinon.stub()}} as unknown) as IBeaconChain;

      const state = await resolveStateId(config, chainStub, dbStub, otherRoot);
      expect(state).to.not.be.null;
      expect(get).to.be.calledOnce;
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
      expect(getCanonicalBlockAtSlot).to.be.calledOnceWithExactly(123);
    });

    it("resolve state on unarchived finalized slot", async function () {
      const nearestArchiveSlot = 1024 * SLOTS_PER_EPOCH;
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
      const {state} = await resolveStateId(config, chainStub, tempDbStub, requestedSlot.toString(), {
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

  describe("getStateValidatorIndex", async function () {
    const state = generateCachedAltairState();
    const pubkey2index = state.epochCtx.pubkey2index;

    it("should return valid: false on invalid input", () => {
      expect(getStateValidatorIndex("foo", state, pubkey2index).valid, "invalid validator id number").to.equal(false);
      expect(getStateValidatorIndex("0xfoo", state, pubkey2index).valid, "invalid hex").to.equal(false);
    });

    it("should return valid: false on validator indices / pubkeys not in the state", () => {
      expect(
        getStateValidatorIndex(String(state.validators.length), state, pubkey2index).valid,
        "validator id not in state"
      ).to.equal(false);
      expect(getStateValidatorIndex("0xabcd", state, pubkey2index).valid, "validator pubkey not in state").to.equal(
        false
      );
    });

    it("should return valid: true on validator indices / pubkeys in the state", () => {
      const index = state.validators.length - 1;
      const resp1 = getStateValidatorIndex(String(index), state, pubkey2index);
      if (resp1.valid) {
        expect(resp1.validatorIndex).to.equal(index);
      } else {
        expect.fail("validator index should be found - validator index input");
      }
      const pubkey = state.validators.get(index).pubkey;
      const resp2 = getStateValidatorIndex(pubkey, state, pubkey2index);
      if (resp2.valid) {
        expect(resp2.validatorIndex).to.equal(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
      const resp3 = getStateValidatorIndex(toHexString(pubkey), state, pubkey2index);
      if (resp3.valid) {
        expect(resp3.validatorIndex).to.equal(index);
      } else {
        expect.fail("validator index should be found - Uint8Array input");
      }
    });
  });
});
