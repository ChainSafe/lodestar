import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/default";
import {List} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {getLatestWeakSubjectivityCheckpointEpoch} from "../../../src/util/weakSubjectivity";
import {generateState} from "../../utils/state";
import {generateValidator} from "../../utils/validator";
import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {computeWeakSubjectivityPeriod, ETH_TO_GWEI} from "../../../src/allForks/util/weakSubjectivity";

describe("weak subjectivity tests", () => {
  describe("getLatestWeakSubjectivityCheckpointEpoch", () => {
    const sandbox = sinon.createSandbox();
    let state: allForks.BeaconState;

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
        state.finalizedCheckpoint.epoch = state.slot / SLOTS_PER_EPOCH;
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

  describe("computeWeakSubjectivityPeriod", function () {
    const testValues = [
      {avgValBalance: BigInt(28), valCount: 32768, wsPeriod: 504},
      {avgValBalance: BigInt(28), valCount: 65536, wsPeriod: 752},
      {avgValBalance: BigInt(28), valCount: 131072, wsPeriod: 1248},
      {avgValBalance: BigInt(28), valCount: 262144, wsPeriod: 2241},
      {avgValBalance: BigInt(28), valCount: 524288, wsPeriod: 2241},
      {avgValBalance: BigInt(28), valCount: 1048576, wsPeriod: 2241},
      {avgValBalance: BigInt(32), valCount: 32768, wsPeriod: 665},
      {avgValBalance: BigInt(32), valCount: 65536, wsPeriod: 1075},
      {avgValBalance: BigInt(32), valCount: 131072, wsPeriod: 1894},
      {avgValBalance: BigInt(32), valCount: 262144, wsPeriod: 3532},
      {avgValBalance: BigInt(32), valCount: 524288, wsPeriod: 3532},
      {avgValBalance: BigInt(32), valCount: 1048576, wsPeriod: 3532},
    ];

    const state = generateState();
    const validatorPool = Array.from({length: 1048576}, () => generateValidator({activation: 0, exit: Infinity}));

    for (const testValue of testValues) {
      it(`should have wsPeriod ${testValue.wsPeriod} with avgValBalance: ${testValue.avgValBalance} and valCount: ${testValue.valCount}`, () => {
        state.validators = validatorPool.slice(0, testValue.valCount).map((v) => v) as List<phase0.Validator>;
        for (const v in state.validators) {
          state.validators[v].effectiveBalance = testValue.avgValBalance * ETH_TO_GWEI;
        }
        const wsPeriod = computeWeakSubjectivityPeriod(config, state);
        expect(wsPeriod).to.equal(testValue.wsPeriod);
      });
    }
  });
});
