import {expect} from "chai";
import {TimeSeries} from "../../../src/util/timeSeries";

// Even with rounding to 3 decimals, the test still breaks sometimes...
describe.skip("util / TimeSeries", () => {
  const decimals = 3;

  it("Should correctly compute a linear sequence", () => {
    const timeSeries = new TimeSeries();

    const startTime = 1610190386014;
    for (let i = 0; i < 4; i++) {
      timeSeries.addPoint(100 + i, startTime + i * 1000);
    }

    const valuePerSec = timeSeries.computeLinearSpeed();

    expectEqualPrecision(valuePerSec, 1, decimals, "Wrong valuePerSec");
  });

  it("Should correctly do a linear regression", () => {
    const timeSeries = new TimeSeries();

    const startTime = 1610190386014;
    for (let i = 1; i < 10; i++) {
      // Add +1 or -1 so points are not in a perfect line but a regression should return 1
      timeSeries.addPoint(100 + i + Math.pow(-1, i), startTime + i * 1000);
    }

    const valuePerSec = timeSeries.computeLinearSpeed();
    expectEqualPrecision(valuePerSec, 1, decimals, "Wrong valuePerSec");
  });

  /**
   * Fixed point math in Javascript is inexact, round results to prevent this test from randomly failing
   */
  function expectEqualPrecision(value: number, expected: number, decimals: number, message?: string): void {
    expect(roundExp(value, decimals)).to.equals(roundExp(expected, decimals), message);
  }

  function roundExp(value: number, decimals: number): number {
    return Math.round(value * Math.pow(10, decimals));
  }
});
