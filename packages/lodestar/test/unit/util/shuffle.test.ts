import {expect} from "chai";
import {shuffle} from "../../../src/util/shuffle";

describe("util / shuffle", () => {
  function shuffleUntilDifferent<T>(arr: T[]): T[] {
    const MAX_ATTEMPTS = 100;
    const arrCopy = [...arr];

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const randArr = shuffle(arr);

      // Assert the shuffle function has returned a different array in case
      // there's the extreme coincidence where the shuffled arr is the same
      for (const i of arrCopy.keys()) {
        if (arrCopy[i] !== randArr[i]) return randArr;
      }
    }

    throw Error("shuffle did not return a different array");
  }

  it("Should randomize an array without mutation", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const arrCopy = [...arr];

    const randArr = shuffleUntilDifferent(arr);

    expect(randArr).to.not.deep.equal(arr, "randArr must not equal arr");
    expect(randArr.sort()).to.deep.equal(arr, "randArr.sort() must equal arr");
    expect(arr).to.deep.equal(arrCopy, "Original array was mutated");
  });
});
