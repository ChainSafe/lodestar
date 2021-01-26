import {init} from "@chainsafe/bls";
import {CachedBeaconState, createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {Validator} from "@chainsafe/lodestar-types";
import {interopSecretKey} from "@chainsafe/lodestar-utils";
import {List, toHexString} from "@chainsafe/ssz";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {getEpochBeaconCommittees, resolveStateId} from "../../../../../../src/api/impl/beacon/state/utils";
import {generateBlockSummary} from "../../../../../utils/block";
import {generateCachedState, generateState} from "../../../../../utils/state";
import {StubbedBeaconDb} from "../../../../../utils/stub";

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
      dbStub.stateCache.get.resolves(generateCachedState());
      const state = await resolveStateId(dbStub, forkChoiceStub, "head");
      expect(state).to.not.be.null;
      expect(forkChoiceStub.getHead.calledOnce).to.be.true;
      expect(dbStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve genesis state id - success", async function () {
      dbStub.stateArchive.get.withArgs(0).resolves(generateState());
      const state = await resolveStateId(dbStub, forkChoiceStub, "genesis");
      expect(state).to.not.be.null;
      expect(dbStub.stateArchive.get.withArgs(0).calledOnce).to.be.true;
    });

    it("resolve finalized state id - success", async function () {
      forkChoiceStub.getFinalizedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      dbStub.stateCache.get.resolves(generateCachedState());
      const state = await resolveStateId(dbStub, forkChoiceStub, "finalized");
      expect(state).to.not.be.null;
      expect(forkChoiceStub.getFinalizedCheckpoint.calledOnce).to.be.true;
      expect(dbStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve finalized state id - missing state", async function () {
      forkChoiceStub.getFinalizedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      dbStub.stateCache.get.resolves(null);
      const state = await resolveStateId(dbStub, forkChoiceStub, "finalized");
      expect(state).to.be.null;
      expect(forkChoiceStub.getFinalizedCheckpoint.calledOnce).to.be.true;
      expect(dbStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve justified state id - success", async function () {
      forkChoiceStub.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      dbStub.stateCache.get.resolves(generateCachedState());
      const state = await resolveStateId(dbStub, forkChoiceStub, "justified");
      expect(state).to.not.be.null;
      expect(forkChoiceStub.getJustifiedCheckpoint.calledOnce).to.be.true;
      expect(dbStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve justified state id - missing state", async function () {
      forkChoiceStub.getJustifiedCheckpoint.returns({root: Buffer.alloc(32, 1), epoch: 1});
      dbStub.stateCache.get.resolves(null);
      const state = await resolveStateId(dbStub, forkChoiceStub, "justified");
      expect(state).to.be.null;
      expect(forkChoiceStub.getJustifiedCheckpoint.calledOnce).to.be.true;
      expect(dbStub.stateCache.get.calledOnce).to.be.true;
    });

    it("resolve state by root", async function () {
      dbStub.stateCache.get.resolves(generateCachedState());
      const state = await resolveStateId(dbStub, forkChoiceStub, toHexString(Buffer.alloc(32, 1)));
      expect(state).to.not.be.null;
      expect(dbStub.stateCache.get.calledOnce).to.be.true;
    });

    it.skip("resolve finalized state by root", async function () {
      dbStub.stateCache.get.resolves(generateCachedState());
      const state = await resolveStateId(dbStub, forkChoiceStub, toHexString(Buffer.alloc(32, 1)));
      expect(state).to.be.null;
      expect(dbStub.stateCache.get.calledOnce).to.be.true;
    });

    it("state id is invalid root", async function () {
      await expect(resolveStateId(dbStub, forkChoiceStub, "adcas")).to.be.eventually.rejected;
      expect(dbStub.stateCache.get.notCalled).to.be.true;
    });

    it("resolve state by slot", async function () {
      forkChoiceStub.getCanonicalBlockSummaryAtSlot
        .withArgs(123)
        .returns(generateBlockSummary({stateRoot: Buffer.alloc(32, 1)}));
      dbStub.stateCache.get.resolves(generateCachedState());
      const state = await resolveStateId(dbStub, forkChoiceStub, "123");
      expect(state).to.not.be.null;
      expect(forkChoiceStub.getCanonicalBlockSummaryAtSlot.withArgs(123).calledOnce).to.be.true;
    });
  });

  describe("getEpochBeaconCommittees", function () {
    let seedState: CachedBeaconState;
    let cachedState: CachedBeaconState;
    before(async function () {
      await init("blst-native");
      const validators: Validator[] = [];
      for (let i = 0; i < 100; i++) {
        validators.push({
          pubkey: interopSecretKey(i).toPublicKey().toBytes(),
          withdrawalCredentials: Buffer.alloc(32),
          effectiveBalance: BigInt(1000000000000),
          slashed: false,
          activationEligibilityEpoch: i + 10,
          activationEpoch: i,
          exitEpoch: i + 2000,
          withdrawableEpoch: i + 2030,
        });
      }
      const state = generateState({
        validators: validators as List<Validator>,
        slot: 100 * config.params.SLOTS_PER_EPOCH,
      });
      seedState = createCachedBeaconState(config, state);
    });

    beforeEach(function () {
      cachedState = seedState.clone();
    });

    it("current epoch with epoch context", function () {
      const committees = getEpochBeaconCommittees(config, cachedState, cachedState.currentShuffling.epoch);
      expect(committees).to.be.deep.equal(cachedState.currentShuffling.committees);
    });

    it("previous epoch with epoch context", function () {
      const committees = getEpochBeaconCommittees(config, cachedState, cachedState.previousShuffling.epoch);
      expect(committees).to.be.deep.equal(cachedState.previousShuffling.committees);
    });

    it("old/new epoch with epoch context", function () {
      const epoch = cachedState.nextShuffling.epoch + 1;
      const committees = getEpochBeaconCommittees(config, cachedState, epoch);
      expect(committees[0][0][0]).to.not.be.undefined;
    });

    it("no epoch context", function () {
      const committees = getEpochBeaconCommittees(
        config,
        cachedState.getOriginalState(),
        cachedState.currentShuffling.epoch
      );
      expect(committees[0][0][0]).to.not.be.undefined;
    });
  });
});
