import {expect} from "chai";
import {resolveOrRacePromises} from "../../src/promise.js";
import {NonEmptyArray} from "../../src/types.js";

describe("racePromisesWithCutoff", () => {
  const cutoffMs = 1000;
  const timeoutMs = 1500;

  const resolveAfter = (value: string, delay: number): Promise<string> =>
    new Promise((resolve) => {
      setTimeout(() => resolve(value), delay);
    });
  const rejectAfter = (value: string, delay: number): Promise<string> =>
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(Error(value)), delay);
    });

  const testCases: [string, number[], (string | Error)[]][] = [
    ["all resolve pre-cutoff", [100, 200], ["100", "200"]],
    ["all resolve/reject pre-cutoff", [100, -200], ["100", "-200"]],
    ["all reject pre-cutoff", [-100, -200], ["-100", "-200"]],
    ["all reject pre-timeout", [-1100, -1200], ["-1100", "-1200"]],
    ["race and resolve pre-timeout", [1100, 1200], ["1100", "pending"]],
    ["race and resolve/reject pre-timeout", [-1100, 1200, 1300], ["-1100", "1200", "pending"]],
    [
      "some resolve pre-cutoff with no race post cutoff",
      [100, -200, -1100, 1200],
      ["100", "-200", "pending", "pending"],
    ],
    [
      "some reject pre-cutoff, with race resolution pre-timeout",
      [-100, -200, -1100, 1100, 1200],
      ["-100", "-200", "-1100", "1100", "pending"],
    ],
    ["some reject pre-cutoff, rest reject pre-timeout", [-100, -200, -1100, -1200], ["-100", "-200", "-1100", "-1200"]],
    [
      "some resolve/reject pre-cutoff, some resolve/reject pre-timeout but no race beyond cutoff",
      [100, -200, -1100, 1100, 1700, -1700],
      ["100", "-200", "pending", "pending", "pending", "pending"],
    ],
    [
      "none resolve/reject pre-cutoff with race resolution pre timeout",
      [-1100, 1200, 1700],
      ["-1100", "1200", "pending"],
    ],
    ["none resolve pre-cutoff with race resolution pre timeout", [1100, 1200, 1700], ["1100", "pending", "pending"]],
    [
      "some reject pre-cutoff, some reject pre-timeout, but no resolution till timeout",
      [-100, -1100, -1200, 1700, -1800],
      ["-100", "-1100", "-1200", "pending", "pending"],
    ],
    ["none resolve/reject pre timeout", [1600, -1700], ["pending", "pending"]],
  ];

  for (const [name, timeouts, results] of testCases) {
    it(name, async () => {
      const testPromises = timeouts.map((timeMs) => {
        if (timeMs > 0) {
          return resolveAfter(`${timeMs}`, timeMs);
        } else {
          return rejectAfter(`${timeMs}`, -timeMs);
        }
      });
      const testResults = await resolveOrRacePromises(testPromises as NonEmptyArray<Promise<unknown>>, {
        resolveTimeoutMs: cutoffMs,
        raceTimeoutMs: timeoutMs,
      });
      const testResultsCmp = testResults.map((r) => {
        switch (r.status) {
          case "fulfilled":
            return r.value;
          case "rejected":
            return (r.reason as Error).message;
          case "pending":
            return "pending";
        }
      });
      expect(testResultsCmp).to.be.deep.equal(results);
    });
  }
});
