import {describe, it, expect} from "vitest";
import {
  INACTIVITY_SCORE_SIZE,
  findModifiedInactivityScores,
} from "../../../../src/util/loadState/findModifiedInactivityScores.js";

describe("findModifiedInactivityScores", () => {
  const numValidator = 100;
  const expectedModifiedValidatorsArr: number[][] = [
    [],
    [0, 2],
    [0, 2, 4, 5, 6, 7, 8, 9],
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 91, 92, 93, 94],
  ];

  const inactivityScoresBytes = new Uint8Array(numValidator * INACTIVITY_SCORE_SIZE);

  for (const expectedModifiedValidators of expectedModifiedValidatorsArr) {
    const testCaseName =
      expectedModifiedValidators.length === 0
        ? "no difference"
        : expectedModifiedValidators.length + " modified validators";
    it(testCaseName, () => {
      const inactivityScoresBytes2 = inactivityScoresBytes.slice();
      for (const validatorIndex of expectedModifiedValidators) {
        inactivityScoresBytes2[validatorIndex * INACTIVITY_SCORE_SIZE] = 1;
      }
      const modifiedValidators: number[] = [];
      findModifiedInactivityScores(inactivityScoresBytes, inactivityScoresBytes2, modifiedValidators);
      expect(modifiedValidators.sort((a, b) => a - b)).toEqual(expectedModifiedValidators);
    });
  }
});
