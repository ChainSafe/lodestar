import {expect} from "chai";
import {TimeSeries} from "../../../../src/sync/stats/timeSeries";

describe("sync / stats / TimeSeries", () => {
  it("Should correctly compute a linear sequence", () => {
    const timeSeries = new TimeSeries();

    const startTime = 1610190386014;
    for (let i = 0; i < 4; i++) {
      timeSeries.addPoint(100 + i, startTime + i * 1000);
    }

    const valuePerSec = timeSeries.computeLinearSpeed();
    // Fixed point math in Javascript is inexact, use .toPrecision to prevent this test from randomly failing
    expect(+valuePerSec.toPrecision(4)).to.equal(1, "Wrong valuePerSec");
  });

  it("Should correctly do a linear regression", () => {
    const timeSeries = new TimeSeries();

    const startTime = 1610190386014;
    for (let i = 1; i < 10; i++) {
      // Add +1 or -1 so points are not in a perfect line but a regression should return 1
      timeSeries.addPoint(100 + i + Math.pow(-1, i), startTime + i * 1000);
    }

    const valuePerSec = timeSeries.computeLinearSpeed();
    expect(+valuePerSec.toPrecision(4)).to.equal(1, "Wrong valuePerSec");
  });
});
