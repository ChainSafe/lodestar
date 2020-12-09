import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState, Validator} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {List, TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {createCachedValidatorsBeaconState, CachedValidatorsBeaconState} from "../../../../src/fast/util";
import {generateState} from "../../../utils/state";

const NUM_VALIDATORS = 100000;

describe("StateTransitionBeaconState", function () {
  let state: TreeBacked<BeaconState>;
  let wrappedState: CachedValidatorsBeaconState;
  const logger = new WinstonLogger();

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
    expect(wrappedState.flatValidators()[1000].activationEpoch).to.be.equal(1000);
  });

  it("should modify both state and wrappedState", () => {
    wrappedState.setValidator(1000, {activationEpoch: 2020});
    expect(wrappedState.flatValidators()[1000].activationEpoch).to.be.equal(2020);
    expect(state.validators[1000].activationEpoch).to.be.equal(2020);
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
    expect(wrappedState.flatValidators()[NUM_VALIDATORS].activationEpoch).to.be.equal(NUM_VALIDATORS);
    expect(state.validators[NUM_VALIDATORS].activationEpoch).to.be.equal(NUM_VALIDATORS);
  });

  it("should not take time from 2nd loop", () => {
    logger.profile("First loop");
    wrappedState.flatValidators().forEach((v) => v.activationEpoch);
    logger.profile("First loop");
    logger.profile("Second loop");
    wrappedState.flatValidators().forEach((v) => v.activationEpoch);
    logger.profile("Second loop");
    logger.profile("Third loop");
    wrappedState.flatValidators().forEach((v) => v.activationEpoch);
    logger.profile("Third loop");
  });
});
