import {describe, it, expect} from "vitest";
import {config} from "@lodestar/config/default";
import {computeWeakSubjectivityPeriodFromConstituents} from "../../../src/util/weakSubjectivity.js";
import {getChurnLimit} from "../../../src/util/validator.js";

describe("weak subjectivity tests", () => {
  describe("computeWeakSubjectivityPeriodFromConstituents", () => {
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
      ({valCount, avgValBalance}) => {
        const wsPeriod = computeWeakSubjectivityPeriodFromConstituents(
          valCount,
          avgValBalance * valCount,
          getChurnLimit(config, valCount),
          config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY
        );
        expect(wsPeriod).toBe(wsPeriod);
      }
    );
  });
});
