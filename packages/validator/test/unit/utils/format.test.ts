import {expect} from "chai";
import {formatBigDecimal} from "../../../src/util/format.js";

describe("util / formatBigDecimal", function () {
  const testCases: [bigint, bigint, bigint, string][] = [
    [BigInt("103797739275696858"), BigInt("1000000000000000000"), BigInt("100000"), "0.10379"],
    [BigInt("103797739275696858"), BigInt("1000000000000000000"), BigInt("1000"), "0.103"],
    [BigInt("111103797739275696858"), BigInt("1000000000000000000"), BigInt("100000"), "111.10379"],
    [BigInt("111103797739275696858"), BigInt("1000000000000000000"), BigInt("1000"), "111.103"],
    [BigInt("1037977392756"), BigInt("1000000000000000000"), BigInt("100000"), "0.0"],
  ];
  for (const [numerator, denominator, decimalFactor, expectedString] of testCases) {
    it(`format ${numerator} / ${denominator} correctly to ${expectedString}`, () => {
      expect(formatBigDecimal(numerator, denominator, decimalFactor)).to.be.equal(expectedString);
    });
  }
});
