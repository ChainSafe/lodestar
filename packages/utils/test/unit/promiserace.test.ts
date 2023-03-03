import {expect} from "chai";
import {racePromisesWithCutoff, RaceEvent} from "../../src/promise.js";

describe("assert", () => {
  const cutoff = 1000;
  const timeout = 3000;

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
