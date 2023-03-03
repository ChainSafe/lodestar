import {expect} from "chai";
import {racePromisesWithCutoff, RaceEvent} from "../../src/promise.js";

describe("racePromisesWithCutoff", () => {
  const cutoff = 1000;
  const timeout = 1500;

  const resolveAfter = (value: string, delay: number): Promise<string> =>
    new Promise((resolve) => {
      setTimeout(() => resolve(value), delay);
    });
  const rejectAfter = (value: string, delay: number): Promise<string> =>
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(Error(value)), delay);
    });

  // Second item in testcase row i.e. array of numbers represent delay at which promise to be resolved
  // or rejected (-ve number)
  // Third item in testcase row is the expected value or error message in string
  // Last item is expected events
  const testcases: [string, number[], (string | Error)[], RaceEvent[]][] = [
    ["all resolve pre-cutoff", [100, 200], ["100", "200"], [RaceEvent.precutoff]],
    ["all resolve/reject pre-cutoff", [100, -200], ["100", "-200"], [RaceEvent.precutoff]],
    ["all reject pre-cutoff", [-100, -200], ["-100", "-200"], [RaceEvent.precutoff]],
    ["all reject pre-timeout", [-1100, -1200], ["-1100", "-1200"], [RaceEvent.cutoff, RaceEvent.pretimeout]],
    ["race and resolve pre-timeout", [1100, 1200], ["1100", "pending"], [RaceEvent.cutoff, RaceEvent.pretimeout]],
    [
      "race and resolve/reject pre-timeout",
      [-1100, 1200, 1300],
      ["-1100", "1200", "pending"],
      [RaceEvent.cutoff, RaceEvent.pretimeout],
    ],
    [
      "some resolve pre-cutoff with no race post cutoff",
      [100, -200, -1100, 1200],
      ["100", "-200", "pending", "pending"],
      [RaceEvent.resolvedatcutoff],
    ],
    [
      "some reject pre-cutoff, with race resolution pre-timeout",
      [-100, -200, -1100, 1100, 1200],
      ["-100", "-200", "-1100", "1100", "pending"],
      [RaceEvent.cutoff, RaceEvent.pretimeout],
    ],
    [
      "some reject pre-cutoff, rest reject pre-timeout",
      [-100, -200, -1100, -1200],
      ["-100", "-200", "-1100", "-1200"],
      [RaceEvent.cutoff, RaceEvent.pretimeout],
    ],
    [
      "some resolve/reject pre-cutoff, some resolve/reject pre-timeout but no race beyond cutoff",
      [100, -200, -1100, 1100, 1700, -1700],
      ["100", "-200", "pending", "pending", "pending", "pending"],
      [RaceEvent.resolvedatcutoff],
    ],
    [
      "none resolve/reject pre-cutoff with race resolution pre timeout",
      [-1100, 1200, 1700],
      ["-1100", "1200", "pending"],
      [RaceEvent.cutoff, RaceEvent.pretimeout],
    ],
    [
      "none resolve pre-cutoff with race resolution pre timeout",
      [1100, 1200, 1700],
      ["1100", "pending", "pending"],
      [RaceEvent.cutoff, RaceEvent.pretimeout],
    ],
    [
      "some reject pre-cutoff, some reject pre-timeout, but no resolution till timeout",
      [-100, -1100, -1200, 1700, -1800],
      ["-100", "-1100", "-1200", "pending", "pending"],
      [RaceEvent.cutoff, RaceEvent.timeout],
    ],
    ["none resolve/reject pre timeout", [1600, -1700], ["pending", "pending"], [RaceEvent.cutoff, RaceEvent.timeout]],
  ];

  for (const [name, promises, results, events] of testcases) {
    it(name, async () => {
      const testPromises = promises.map((timeMs) => {
        if (timeMs > 0) {
          return resolveAfter(`${timeMs}`, timeMs);
        } else {
          return rejectAfter(`${timeMs}`, -timeMs);
        }
      });
      const testEvents: RaceEvent[] = [];
      const testResults = await racePromisesWithCutoff(testPromises, cutoff, timeout, (event) =>
        testEvents.push(event)
      );
      const testResultsCmp = testResults.map((res: string | Error) => (res instanceof Error ? res.message : res));
      expect({results: testResultsCmp, events: testEvents}).to.be.deep.equal({results, events});
    });
  }
});
