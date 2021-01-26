import {init} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState, Validator} from "@chainsafe/lodestar-types";
import {List, TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {interopSecretKey} from "../../../../../lodestar-utils/lib";
import {CachedBeaconState, createCachedBeaconState} from "../../../../src/fast/util";
import {generateState} from "../../../utils/state";

const NUM_VALIDATORS = 2000;
// make sure there are a lot of active validators
const SLOT = 2000 * config.params.SLOTS_PER_EPOCH;

describe("CachedBeaconState", function () {
  let state: TreeBacked<BeaconState>;
  let seedState: TreeBacked<BeaconState>;
  let cachedState: CachedBeaconState;
  const validators: Validator[] = [];

  before(async function () {
    await init("blst-native");
    for (let i = 0; i < NUM_VALIDATORS; i++) {
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
    const defaultState = generateState({validators: validators as List<Validator>, slot: SLOT});
    seedState = config.types.BeaconState.tree.createValue(defaultState);
  });

  beforeEach(function () {
    state = seedState.clone();
    cachedState = createCachedBeaconState(config, state);
  });

  describe("cache validators", () => {
    it("should read the same value of TreeBacked<BeaconState>", function () {
      expect(state.validators[1000].activationEpoch).to.be.equal(1000);
      expect(cachedState.validators[1000].activationEpoch).to.be.equal(1000);
      expect(cachedState.flatValidators().get(1000)!.activationEpoch).to.be.equal(1000);
    });

    it("should modify both state and cachedState", () => {
      const oldFlatValidator = cachedState.flatValidators().get(1000);
      cachedState.updateValidator(1000, {activationEpoch: 2020, exitEpoch: 2030});
      expect(cachedState.flatValidators().get(1000)!.activationEpoch).to.be.equal(2020);
      expect(cachedState.flatValidators().get(1000)!.exitEpoch).to.be.equal(2030);
      // other properties are the same
      expect(cachedState.flatValidators().get(1000)!.effectiveBalance).to.be.equal(oldFlatValidator?.effectiveBalance);
      expect(cachedState.flatValidators().get(1000)!.slashed).to.be.equal(oldFlatValidator?.slashed);
      expect(cachedState.flatValidators().get(1000)!.activationEligibilityEpoch).to.be.equal(
        oldFlatValidator?.activationEligibilityEpoch
      );
      expect(cachedState.flatValidators().get(1000)!.withdrawableEpoch).to.be.equal(
        oldFlatValidator?.withdrawableEpoch
      );

      expect(state.validators[1000].activationEpoch).to.be.equal(2020);
      expect(state.validators[1000].exitEpoch).to.be.equal(2030);
      // other properties are the same
      expect(state.validators[1000].effectiveBalance).to.be.equal(oldFlatValidator?.effectiveBalance);
      expect(state.validators[1000].slashed).to.be.equal(oldFlatValidator?.slashed);
      expect(state.validators[1000].activationEligibilityEpoch).to.be.equal(
        oldFlatValidator?.activationEligibilityEpoch
      );
      expect(state.validators[1000].withdrawableEpoch).to.be.equal(oldFlatValidator?.withdrawableEpoch);
    });

    it("should add validator to both state and cachedState", function () {
      expect(cachedState.flatValidators().length).to.be.equal(NUM_VALIDATORS);
      cachedState.addValidator({
        pubkey: interopSecretKey(NUM_VALIDATORS).toPublicKey().toBytes(),
        withdrawalCredentials: Buffer.alloc(32),
        effectiveBalance: BigInt(1000000000000),
        slashed: false,
        activationEligibilityEpoch: NUM_VALIDATORS + 10,
        activationEpoch: NUM_VALIDATORS,
        exitEpoch: NUM_VALIDATORS + 20,
        withdrawableEpoch: NUM_VALIDATORS + 30,
      });

      expect(cachedState.flatValidators().length).to.be.equal(NUM_VALIDATORS + 1);
      expect(state.validators.length).to.be.equal(NUM_VALIDATORS + 1);
      expect(cachedState.flatValidators().get(NUM_VALIDATORS)!.activationEpoch).to.be.equal(NUM_VALIDATORS);
      expect(state.validators[NUM_VALIDATORS].activationEpoch).to.be.equal(NUM_VALIDATORS);
    });

    it("should not mutate original state after clone", () => {
      const cloned = cachedState.clone();
      cloned.slot++;
      expect(cloned.slot).to.be.equal(cachedState.slot + 1);
    });
  });

  describe("cache EpochContext", () => {
    it("should get correct public key index", () => {
      expect(cachedState.pubkey2index.get(validators[1000].pubkey)).to.be.equal(1000);
      expect(cachedState.getBeaconProposer(SLOT)).to.be.gte(0);
      expect(cachedState.getBeaconProposer(SLOT)).to.be.lt(NUM_VALIDATORS);
    });

    it("should clone", () => {
      const clonedState = cachedState.clone();
      expect(clonedState.pubkey2index.get(validators[1000].pubkey)).to.be.equal(1000);
      expect(clonedState.getBeaconProposer(SLOT)).to.be.equal(cachedState.getBeaconProposer(SLOT));
      expect(clonedState.getCommitteeCountAtSlot(SLOT)).to.be.deep.equal(cachedState.getCommitteeCountAtSlot(SLOT));
    });

    it("should rotate epoch", function () {
      expect(cachedState.getBeaconProposer(SLOT)).to.be.gte(0);
      cachedState.rotateEpochs();
      expect(() => cachedState.getBeaconProposer(SLOT)).to.throw("beacon proposer index out of range");
      expect(cachedState.getBeaconProposer(SLOT + config.params.SLOTS_PER_EPOCH)).to.be.gte(0);
    });

    it("should sync pubkey", () => {
      const pubkey = interopSecretKey(NUM_VALIDATORS).toPublicKey().toBytes();
      cachedState.addValidator({
        pubkey: pubkey,
        withdrawalCredentials: Buffer.alloc(32),
        effectiveBalance: BigInt(1000000000000),
        slashed: false,
        activationEligibilityEpoch: NUM_VALIDATORS + 10,
        activationEpoch: NUM_VALIDATORS,
        exitEpoch: NUM_VALIDATORS + 20,
        withdrawableEpoch: NUM_VALIDATORS + 30,
      });
      expect(cachedState.pubkey2index.get(pubkey)).to.be.undefined;
      cachedState.syncPubkeys();
      expect(cachedState.pubkey2index.get(pubkey)).to.be.equal(NUM_VALIDATORS);
    });

    it("should not sync pubkey", () => {
      // cachedState is synced upon creation
      const pubkey2index = cachedState.pubkey2index;
      // no need to sync
      cachedState.syncPubkeys();
      expect(cachedState.pubkey2index.size).to.be.equal(pubkey2index.size);
    });
  });

  it("should get original state", () => {
    // compare object reference
    expect(cachedState.getOriginalState()).to.be.equal(state);
    expect(cachedState.getTreeBackedState()).to.be.equal(state);
  });
});
