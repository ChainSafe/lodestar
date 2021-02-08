import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState, Validator} from "@chainsafe/lodestar-types";
import {List, TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {createCachedValidatorsBeaconState, CachedValidatorsBeaconState} from "../../../phase0/fast/util";
import {generateState} from "../../../utils/state";

const NUM_VALIDATORS = 100000;

describe("StateTransitionBeaconState", function () {
  let state: TreeBacked<BeaconState>;
  let wrappedState: CachedValidatorsBeaconState;

  before(function () {
    this.timeout(0);
    const validators: Validator[] = [];
    for (let i = 0; i < NUM_VALIDATORS; i++) {
      validators.push({
        pubkey: Buffer.alloc(48),
        withdrawalCredentials: Buffer.alloc(32),
        effectiveBalance: BigInt(1000000),
        slashed: false,
        activationEligibilityEpoch: i + 10,
        activationEpoch: i,
        exitEpoch: i + 20,
        withdrawableEpoch: i + 30,
      });
    }
    const defaultState = generateState({validators: validators as List<Validator>});
    state = config.types.BeaconState.tree.createValue(defaultState);
  });

  beforeEach(() => {
    state = state.clone();
    wrappedState = createCachedValidatorsBeaconState(state);
  });

  it("should read the same value of TreeBacked<BeaconState>", () => {
    expect(state.validators[1000].activationEpoch).to.be.equal(1000);
    expect(wrappedState.validators[1000].activationEpoch).to.be.equal(1000);
    expect(wrappedState.flatValidators().get(1000)!.activationEpoch).to.be.equal(1000);
  });

  it("should modify both state and wrappedState", () => {
    const oldFlatValidator = wrappedState.flatValidators().get(1000);
    wrappedState.updateValidator(1000, {activationEpoch: 2020, exitEpoch: 2030});
    expect(wrappedState.flatValidators().get(1000)!.activationEpoch).to.be.equal(2020);
    expect(wrappedState.flatValidators().get(1000)!.exitEpoch).to.be.equal(2030);
    // other property is the same
    expect(wrappedState.flatValidators().get(1000)!.effectiveBalance).to.be.equal(oldFlatValidator?.effectiveBalance);
    expect(wrappedState.flatValidators().get(1000)!.slashed).to.be.equal(oldFlatValidator?.slashed);
    expect(wrappedState.flatValidators().get(1000)!.activationEligibilityEpoch).to.be.equal(
      oldFlatValidator?.activationEligibilityEpoch
    );
    expect(wrappedState.flatValidators().get(1000)!.withdrawableEpoch).to.be.equal(oldFlatValidator?.withdrawableEpoch);

    expect(state.validators[1000].activationEpoch).to.be.equal(2020);
    expect(state.validators[1000].exitEpoch).to.be.equal(2030);
    // other property is the same
    expect(state.validators[1000].effectiveBalance).to.be.equal(oldFlatValidator?.effectiveBalance);
    expect(state.validators[1000].slashed).to.be.equal(oldFlatValidator?.slashed);
    expect(state.validators[1000].activationEligibilityEpoch).to.be.equal(oldFlatValidator?.activationEligibilityEpoch);
    expect(state.validators[1000].withdrawableEpoch).to.be.equal(oldFlatValidator?.withdrawableEpoch);
  });

  it("should add validator to both state and wrappedState", () => {
    wrappedState.addValidator({
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      effectiveBalance: BigInt(1000000),
      slashed: false,
      activationEligibilityEpoch: NUM_VALIDATORS + 10,
      activationEpoch: NUM_VALIDATORS,
      exitEpoch: NUM_VALIDATORS + 20,
      withdrawableEpoch: NUM_VALIDATORS + 30,
    });

    expect(wrappedState.flatValidators().length).to.be.equal(NUM_VALIDATORS + 1);
    expect(state.validators.length).to.be.equal(NUM_VALIDATORS + 1);
    expect(wrappedState.flatValidators().get(NUM_VALIDATORS)!.activationEpoch).to.be.equal(NUM_VALIDATORS);
    expect(state.validators[NUM_VALIDATORS].activationEpoch).to.be.equal(NUM_VALIDATORS);
  });
});
