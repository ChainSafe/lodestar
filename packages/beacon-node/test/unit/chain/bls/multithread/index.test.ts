import {expect} from "chai";
import {prepareWork} from "../../../../../src/chain/bls/multithread/index.js";
import {JobItem, QueueItem, SerializedSet} from "../../../../../src/chain/bls/multithread/types.js";

function createMultiSigsQueueItem(): QueueItem {
  return {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    resolve: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    reject: () => {},
    addedTimeMs: Math.random() * 1e9,
    workReq: {opts: {}, sets: [{} as SerializedSet]},
  };
}

function createSameMessageQueueItem(n: number): QueueItem {
  const items: JobItem<SerializedSet>[] = [];
  for (let i = 0; i < n; i++) {
    items.push({
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      resolve: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      reject: () => {},
      addedTimeMs: Math.random() * 1e9,
      workReq: {} as SerializedSet,
    });
  }

  return items;
}

describe("prepareWork", () => {
  const testCases: {
    // true for multi-sig, false for same message
    jobs: boolean[];
    // index in the jobs
    expectedRemainingJobs: number[];
    // index in the jobs, could be 1 item in the case of same message
    expectedResult: number[] | number;
    expectedIsSameMessage: boolean;
  }[] = [
    {
      jobs: [true, true, true, true],
      expectedRemainingJobs: [3],
      expectedResult: [0, 1, 2],
      expectedIsSameMessage: false,
    },
    {jobs: [true, true, false], expectedRemainingJobs: [2], expectedResult: [0, 1], expectedIsSameMessage: false},
    {
      jobs: [true, true, false, true],
      expectedRemainingJobs: [2],
      expectedResult: [0, 1, 3],
      expectedIsSameMessage: false,
    },
    {jobs: [true, false, true], expectedRemainingJobs: [1], expectedResult: [0, 2], expectedIsSameMessage: false},
    {
      jobs: [true, false, true, true],
      expectedRemainingJobs: [1],
      expectedResult: [0, 2, 3],
      expectedIsSameMessage: false,
    },
    {jobs: [true, false, false], expectedRemainingJobs: [1, 2], expectedResult: [0], expectedIsSameMessage: false},
    {
      jobs: [true, false, false, true],
      expectedRemainingJobs: [1, 2],
      expectedResult: [0, 3],
      expectedIsSameMessage: false,
    },
    {jobs: [false], expectedRemainingJobs: [], expectedResult: 0, expectedIsSameMessage: true},
    {jobs: [false, true], expectedRemainingJobs: [1], expectedResult: 0, expectedIsSameMessage: true},
    {jobs: [false, false], expectedRemainingJobs: [1], expectedResult: 0, expectedIsSameMessage: true},
  ];

  let i = 0;
  for (const {jobs, expectedRemainingJobs, expectedResult, expectedIsSameMessage} of testCases) {
    it(`test case ${i++}`, () => {
      const typedJobs = jobs.map((isMultiSig) =>
        isMultiSig ? createMultiSigsQueueItem() : createSameMessageQueueItem(3)
      );

      const copiedJobs = [...typedJobs];
      const result = prepareWork(copiedJobs, 3);
      expect(copiedJobs).to.be.deep.equals(expectedRemainingJobs.map((index) => typedJobs[index]));
      expect(result).to.be.deep.equals({
        isSameMessageJobs: expectedIsSameMessage,
        jobs: Array.isArray(expectedResult)
          ? expectedResult.map((index) => typedJobs[index])
          : typedJobs[expectedResult],
      });
    });
  }
});
