import {expect} from "chai";
import {formatEpochSlotTime} from "../../../src/logger/util.js";

describe("logger / util / formatEpochSlotTime", () => {
  const nowSec = 1619171569;
  const secondsPerSlot = 12;
  const slotsPerEpoch = 32;

  const testCases: {epoch: number; slot: number; sec: number}[] = [
    {epoch: 3, slot: 6, sec: 11.423},
    {epoch: -1, slot: 31, sec: 11.423},
    {epoch: 0, slot: 0, sec: 0.001},
  ];

  for (const {epoch, slot, sec} of testCases) {
    const expectLog = `Eph ${epoch}/${slot} ${sec}`; // "Eph 3/6 11.423";
    it(expectLog, () => {
      const genesisTime = nowSec - epoch * slotsPerEpoch * secondsPerSlot - slot * secondsPerSlot - sec;
      expect(formatEpochSlotTime({genesisTime, secondsPerSlot, slotsPerEpoch}, nowSec * 1000)).to.equal(expectLog);
    });
  }
});
