import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {List} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {BeaconState} from "@chainsafe/lodestar-types/lib/allForks";
import {getLatestWeakSubjectivityCheckpointEpoch} from "../../../../src/util/weakSubjectivity";
import {generateState} from "../../../utils/state";
import {generateValidator} from "../../../utils/validator";
import {expect} from "chai";

describe("getLatestWeakSubjectivityCheckpointEpoch", () => {
  const sandbox = sinon.createSandbox();
  let state: BeaconState;

  beforeEach(() => {
    state = generateState();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const testValues = [
    {activeValidatorCount: 8192, slot: 8192, expectedMod: 256},
    {activeValidatorCount: 16384, slot: 16384, expectedMod: 256},
    {activeValidatorCount: 32768, slot: 32768, expectedMod: 512},
    {activeValidatorCount: 65536, slot: 65536, expectedMod: 1024},
    {activeValidatorCount: 131072, slot: 131072, expectedMod: 1792},
    {activeValidatorCount: 262144, slot: 262144, expectedMod: 3328},
  ];

  for (const testValue of testValues) {
    it(`should have ${testValue.expectedMod} mod for slot ${testValue.slot} and activeValidatorCount of ${testValue.activeValidatorCount}`, () => {
      state.slot = testValue.slot;
      state.finalizedCheckpoint.epoch = state.slot / config.params.SLOTS_PER_EPOCH;
      state.validators = Array.from({length: testValue.activeValidatorCount}, () =>
        generateValidator({activation: 0, exit: Infinity})
      ) as List<phase0.Validator>;
      const wsCheckpointEpoch = getLatestWeakSubjectivityCheckpointEpoch(config, state);
      expect(wsCheckpointEpoch).to.be.equal(
        state.finalizedCheckpoint.epoch - (state.finalizedCheckpoint.epoch % testValue.expectedMod)
      );
    });
  }
});
