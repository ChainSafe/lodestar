import {expect} from "chai";
import {formatEpochSlotTime} from "../../../src/logger/util";

describe("logger / util / formatEpochSlotTime", () => {
  it("Should format epoch slot time", () => {
    const now = 1619171569709;
    const genesisTime = (now - 1235423) / 1000;
    const secondsPerSlot = 12;
    const slotsPerEpoch = 32;
    const expectLog = "Eph 3/6 11.423";

    expect(formatEpochSlotTime({genesisTime, secondsPerSlot, slotsPerEpoch}, now)).to.equal(expectLog);
  });
});
