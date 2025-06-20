import {config} from "@lodestar/config/default";
import {describe, expect, it} from "vitest";
import {getBalanceChurnLimit, getChurnLimit} from "../../../src/util/validator.js";
import {
  computeWeakSubjectivityPeriodFromConstituentsElectra,
  computeWeakSubjectivityPeriodFromConstituentsPhase0,
} from "../../../src/util/weakSubjectivity.js";

describe("weak subjectivity tests", () => {
  describe("computeWeakSubjectivityPeriodFromConstituentsPhase0", () => {
    const balance28 = 28;
    const balance32 = 32;

    const testValues = [
      {avgValBalance: balance28, valCount: 32768, wsPeriod: 504},
      {avgValBalance: balance28, valCount: 65536, wsPeriod: 752},
      {avgValBalance: balance28, valCount: 131072, wsPeriod: 1248},
      {avgValBalance: balance28, valCount: 262144, wsPeriod: 2241},
      {avgValBalance: balance28, valCount: 524288, wsPeriod: 2241},
      {avgValBalance: balance28, valCount: 1048576, wsPeriod: 2241},
      {avgValBalance: balance32, valCount: 32768, wsPeriod: 665},
      {avgValBalance: balance32, valCount: 65536, wsPeriod: 1075},
      {avgValBalance: balance32, valCount: 131072, wsPeriod: 1894},
      {avgValBalance: balance32, valCount: 262144, wsPeriod: 3532},
      {avgValBalance: balance32, valCount: 524288, wsPeriod: 3532},
      {avgValBalance: balance32, valCount: 1048576, wsPeriod: 3532},
    ];

    it.each(testValues)(
      "should have wsPeriod: $wsPeriod with avgValBalance: $avgValBalance and valCount: $valCount",
      ({valCount, avgValBalance, wsPeriod: expectedWsPeriod}) => {
        const wsPeriod = computeWeakSubjectivityPeriodFromConstituentsPhase0(
          valCount,
          avgValBalance * valCount,
          getChurnLimit(config, valCount),
          config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
        );
        expect(wsPeriod).toBe(expectedWsPeriod);
      }
    );
  });
  describe("computeWeakSubjectivityPeriodFromConstituentsElectra", () => {
    // Values from https://github.com/ethereum/consensus-specs/blob/8ebb5e80862641287d7e8db2bbf69fa31612640b/specs/electra/weak-subjectivity.md#weak-subjectivity-period
    const testValues = [
      {totalBalanceIncrement: 1_048_576, wsPeriod: 665},
      {totalBalanceIncrement: 2_097_152, wsPeriod: 1075},
      {totalBalanceIncrement: 4_194_304, wsPeriod: 1894},
      {totalBalanceIncrement: 8_388_608, wsPeriod: 3532},
      {totalBalanceIncrement: 16_777_216, wsPeriod: 3532},
      {totalBalanceIncrement: 33_554_432, wsPeriod: 3532},
    ];

    it.each(testValues)(
      "should have wsPeriod: $wsPeriod with totalActiveBalance: $totalBalanceIncrement",
      ({totalBalanceIncrement, wsPeriod: expectedWsPeriod}) => {
        const wsPeriod = computeWeakSubjectivityPeriodFromConstituentsElectra(
          totalBalanceIncrement,
          getBalanceChurnLimit(
            totalBalanceIncrement,
            config.CHURN_LIMIT_QUOTIENT,
            config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA
          ),
          config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
        );
        expect(wsPeriod).toBe(expectedWsPeriod);
      }
    );
  });
});
