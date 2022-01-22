import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {fromHexString, List, TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {phase0, CachedBeaconStatePhase0, createCachedBeaconState} from "../../../src";
import {generateState} from "../../utils/state";

const NUM_VALIDATORS = 1001;

describe("CachedBeaconState", function () {
  let state: TreeBacked<phase0.BeaconState>;
  let wrappedState: CachedBeaconStatePhase0;

  before(function () {
    this.timeout(0);
    const validators: phase0.Validator[] = [];
    for (let i = 0; i < NUM_VALIDATORS; i++) {
      validators.push({
        pubkey: fromHexString(
          // randomly pregenerated pubkey
          "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576"
        ),
        withdrawalCredentials: Buffer.alloc(32),
        effectiveBalance: 1000000,
        slashed: false,
        activationEligibilityEpoch: i + 10,
        activationEpoch: i,
        exitEpoch: i + 20,
        withdrawableEpoch: i + 30,
      });
    }
    const defaultState = generateState({validators: validators as List<phase0.Validator>});
    state = ssz.phase0.BeaconState.createTreeBackedFromStruct(defaultState);
  });

  beforeEach(() => {
    state = state.clone();
    wrappedState = createCachedBeaconState(config, state);
  });

  it("should read the same value of TreeBacked<BeaconState>", () => {
    expect(state.validators[1000].activationEpoch).to.be.equal(1000);
    expect(wrappedState.validators[1000].activationEpoch).to.be.equal(1000);
  });

  it("should modify both state and wrappedState", () => {
    const oldFlatValidator = wrappedState.validators[1000];
    const validator = wrappedState.validators[1000];
    validator.activationEpoch = 2020;
    validator.exitEpoch = 2030;

    expect(wrappedState.validators[1000].activationEpoch).to.be.equal(2020);
    expect(wrappedState.validators[1000].exitEpoch).to.be.equal(2030);
    // other property is the same
    expect(wrappedState.validators[1000].effectiveBalance).to.be.equal(oldFlatValidator.effectiveBalance);
    expect(wrappedState.validators[1000].slashed).to.be.equal(oldFlatValidator.slashed);
    expect(wrappedState.validators[1000].activationEligibilityEpoch).to.be.equal(
      oldFlatValidator.activationEligibilityEpoch
    );
    expect(wrappedState.validators[1000].withdrawableEpoch).to.be.equal(oldFlatValidator.withdrawableEpoch);

    expect(state.validators[1000].activationEpoch).to.be.equal(2020);
    expect(state.validators[1000].exitEpoch).to.be.equal(2030);
    // other property is the same
    expect(state.validators[1000].effectiveBalance).to.be.equal(oldFlatValidator.effectiveBalance);
    expect(state.validators[1000].slashed).to.be.equal(oldFlatValidator.slashed);
    expect(state.validators[1000].activationEligibilityEpoch).to.be.equal(oldFlatValidator.activationEligibilityEpoch);
    expect(state.validators[1000].withdrawableEpoch).to.be.equal(oldFlatValidator.withdrawableEpoch);
  });

  it("should add validator to both state and wrappedState", () => {
    wrappedState.validators.push({
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      effectiveBalance: 1000000,
      slashed: false,
      activationEligibilityEpoch: NUM_VALIDATORS + 10,
      activationEpoch: NUM_VALIDATORS,
      exitEpoch: NUM_VALIDATORS + 20,
      withdrawableEpoch: NUM_VALIDATORS + 30,
    });

    expect(wrappedState.validators.length).to.be.equal(NUM_VALIDATORS + 1);
    expect(state.validators.length).to.be.equal(NUM_VALIDATORS + 1);
    expect(wrappedState.validators[NUM_VALIDATORS].activationEpoch).to.be.equal(NUM_VALIDATORS);
    expect(state.validators[NUM_VALIDATORS].activationEpoch).to.be.equal(NUM_VALIDATORS);
  });
});
