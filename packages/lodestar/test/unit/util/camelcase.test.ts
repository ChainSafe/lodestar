import {expect} from "chai";

import {camelcase} from "../../../src/util/camelcase";


describe("camelcase", () => {

  const cases: {[from: string]: string} = {
    "one": "one",
    "one_two": "oneTwo",
    "one_two_three": "oneTwoThree",
  };

  for (const from in cases) {
    it(`should convert ${from} to camelCase`, () => {
      expect(camelcase(from)).to.equal(cases[from]);
    });
  }
});
