import {describe, expect, it} from "vitest";
import {formatEpochSlotTime} from "../../../src/utils/timeFormat.js";

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
      expect(formatEpochSlotTime({genesisTime, secondsPerSlot, slotsPerEpoch}, nowSec * 1000)).toBe(expectLog);
    });
  }

  describe("with slot duration change", () => {
    const genesisTime = 1600000000;
    const slotDurations: [number, number][] = [
      [0, secondsPerSlot],
      [2, 10],
    ];
    const forkSec = genesisTime + 2 * slotsPerEpoch * secondsPerSlot;

    const durationTestCases: {name: string; nowSec: number; expectLog: string}[] = [
      {name: "before the fork", nowSec: genesisTime + 45 * secondsPerSlot + 11.423, expectLog: "Eph 1/13 11.423"},
      {name: "at fork activation", nowSec: forkSec, expectLog: "Eph 2/0 0.000"},
      {name: "after the fork", nowSec: forkSec + 37 * 10 + 1.5, expectLog: "Eph 3/5 1.500"},
    ];

    for (const {name, nowSec: now, expectLog} of durationTestCases) {
      it(`${name} (${expectLog})`, () => {
        expect(formatEpochSlotTime({genesisTime, secondsPerSlot, slotsPerEpoch, slotDurations}, now * 1000)).toBe(
          expectLog
        );
      });
    }
  });
});
