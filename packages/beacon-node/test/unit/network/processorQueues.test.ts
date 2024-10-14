import {describe, it, expect} from "vitest";
import {sleep} from "@lodestar/utils";

type ValidateOpts = {
  skipAsync1: boolean;
  skipAsync2: boolean;
};

async function validateTest(job: string, tracker: string[], opts: ValidateOpts): Promise<void> {
  tracker.push(`job:${job} step:0`);

  await getStateFromCache(opts.skipAsync1);
  tracker.push(`job:${job} step:1`);

  if (!opts.skipAsync2) {
    await sleep(0);
  }
  tracker.push(`job:${job} step:2`);
}

async function getStateFromCache(retrieveSync: boolean): Promise<number> {
  if (retrieveSync) {
    return 1;
  }

  await sleep(0);
  return 2;
}

describe("event loop with branching async", () => {
  const eachAwaitPointHoldsJobs = [
    "job:0 step:0",
    "job:1 step:0",
    "job:2 step:0",
    "job:0 step:1",
    "job:1 step:1",
    "job:2 step:1",
    "job:0 step:2",
    "job:1 step:2",
    "job:2 step:2",
  ];

  const onlyStartOfStep1HoldsJobs = [
    "job:0 step:0",
    "job:1 step:0",
    "job:2 step:0",
    "job:0 step:1",
    "job:0 step:2",
    "job:1 step:1",
    "job:1 step:2",
    "job:2 step:1",
    "job:2 step:2",
  ];

  const eachJobCompletesInSequence = [
    "job:0 step:0",
    "job:0 step:1",
    "job:0 step:2",
    "job:1 step:0",
    "job:1 step:1",
    "job:1 step:2",
    "job:2 step:0",
    "job:2 step:1",
    "job:2 step:2",
  ];

  const testCases: {opts: ValidateOpts; expectedTrackerVoid: string[]; expectedTrackerAwait: string[]}[] = [
    {
      opts: {skipAsync1: false, skipAsync2: false},
      expectedTrackerVoid: eachAwaitPointHoldsJobs,
      expectedTrackerAwait: eachJobCompletesInSequence,
    },
    {
      opts: {skipAsync1: true, skipAsync2: false},
      expectedTrackerVoid: eachAwaitPointHoldsJobs,
      expectedTrackerAwait: eachJobCompletesInSequence,
    },
    {
      opts: {skipAsync1: false, skipAsync2: true},
      expectedTrackerVoid: onlyStartOfStep1HoldsJobs,
      expectedTrackerAwait: eachJobCompletesInSequence,
    },
    {
      opts: {skipAsync1: true, skipAsync2: true},
      expectedTrackerVoid: onlyStartOfStep1HoldsJobs,
      expectedTrackerAwait: eachJobCompletesInSequence,
    },
  ];

  for (const {opts, expectedTrackerVoid, expectedTrackerAwait} of testCases) {
    const jobs: string[] = [];
    for (let i = 0; i < 3; i++) jobs.push(String(i));

    it(`${JSON.stringify(opts)} Promise.all`, async () => {
      const tracker: string[] = [];
      await Promise.all(jobs.map((job) => validateTest(job, tracker, opts)));
      expect(tracker).toEqual(expectedTrackerVoid);
    });

    it(`${JSON.stringify(opts)} await each`, async () => {
      const tracker: string[] = [];
      for (const job of jobs) {
        await validateTest(job, tracker, opts);
      }
      expect(tracker).toEqual(expectedTrackerAwait);
    });
  }
});
